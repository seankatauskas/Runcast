import { randomUUID } from 'node:crypto';
import {
  stravaAuthAuthorizationRequestSchema,
  stravaAuthorizationSchema,
  stravaExchangeRequestSchema,
  stravaImportSchema,
} from '@runcast/contracts';
import {
  adaptPlannableRouteV1,
  PlanningGpxParseError,
  parsePlanningGpx,
  type PlanningRoute,
} from '@runcast/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../authenticate';
import { config } from '../config';
import { db } from '../db/client';
import {
  authIdentities,
  oauthStates,
  preferences,
  routes,
  stravaConnections,
  stravaExchangeCodes,
  users,
} from '../db/schema';
import { AppError } from '../errors';
import { noStore, parseBody } from '../http';
import { mutateIdempotently, replayIdempotent } from '../idempotency';
import {
  exchangeStravaCode,
  exportStravaRoute,
  listStravaRoutes,
  refreshStravaToken,
  revokeStravaToken,
  stravaAuthorizationUrl,
  type StravaTokens,
} from '../providers/strava';
import { decryptSecret, encryptSecret, hashToken, opaqueToken } from '../security/crypto';
import { createSession } from '../session';
import { persistRoute, routeResponse } from './routes';

const OAUTH_STATE_LIFETIME_MS = 10 * 60_000;
const EXCHANGE_CODE_LIFETIME_MS = 5 * 60_000;

export function validateMobileRedirectUri(
  value: string,
  allowedProtocol = new URL(config.mobileDeepLink).protocol,
): string {
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    throw new AppError(400, 'INVALID_REDIRECT_URI', 'Redirect URI is invalid');
  }
  const allowed =
    redirect.protocol === allowedProtocol &&
    !redirect.username &&
    !redirect.password &&
    !redirect.port &&
    !redirect.search &&
    !redirect.hash &&
    ((redirect.hostname === 'auth' && redirect.pathname === '/strava') ||
      ((redirect.hostname === 'account' || redirect.hostname === 'strava-routes') &&
        (redirect.pathname === '' || redirect.pathname === '/')));
  if (!allowed) {
    throw new AppError(
      400,
      'INVALID_REDIRECT_URI',
      'Strava authorization must return to an approved Runcast app route',
    );
  }
  return value;
}

function redirectWith(uri: string, params: Record<string, string>): string {
  const target = new URL(uri);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}

async function connectionFor(userId: string): Promise<typeof stravaConnections.$inferSelect> {
  const [connection] = await db
    .select()
    .from(stravaConnections)
    .where(eq(stravaConnections.userId, userId))
    .limit(1);
  if (!connection)
    throw new AppError(404, 'STRAVA_NOT_CONNECTED', 'Connect Strava before using this feature');
  if (connection.expiresAt.getTime() > Date.now() + 60_000) return connection;
  const refreshed = await refreshStravaToken(decryptSecret(connection.refreshTokenEncrypted));
  const [updated] = await db
    .update(stravaConnections)
    .set({
      accessTokenEncrypted: encryptSecret(refreshed.accessToken),
      refreshTokenEncrypted: encryptSecret(refreshed.refreshToken),
      expiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(stravaConnections.id, connection.id))
    .returning();
  return updated;
}

function connectionValues(userId: string, tokens: StravaTokens, scopes: string[]) {
  return {
    userId,
    athleteId: tokens.athleteId,
    accessTokenEncrypted: encryptSecret(tokens.accessToken),
    refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    scopes,
  };
}

async function createAuthorization(
  purpose: 'sign_in' | 'link',
  userId: string | null,
  deviceId: string,
  redirectUri: string,
) {
  const state = opaqueToken(32);
  const expiresAt = new Date(Date.now() + OAUTH_STATE_LIFETIME_MS);
  await db.insert(oauthStates).values({
    userId,
    purpose,
    deviceId,
    stateHash: hashToken(state),
    redirectUri: validateMobileRedirectUri(redirectUri),
    expiresAt,
  });
  return {
    authorizationUrl: stravaAuthorizationUrl(state),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function stravaRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/auth/strava/authorization',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      noStore(reply);
      const body = parseBody(stravaAuthAuthorizationRequestSchema, request);
      if (body.purpose === 'link') await authenticate(request, reply);
      return createAuthorization(
        body.purpose,
        body.purpose === 'link' ? request.auth.userId : null,
        body.deviceId,
        body.redirectUri,
      );
    },
  );

  app.post(
    '/v1/auth/strava/exchange',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      noStore(reply);
      const body = parseBody(stravaExchangeRequestSchema, request);
      const [exchange] = await db
        .update(stravaExchangeCodes)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(stravaExchangeCodes.codeHash, hashToken(body.code)),
            eq(stravaExchangeCodes.deviceId, body.deviceId),
            isNull(stravaExchangeCodes.consumedAt),
            gt(stravaExchangeCodes.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!exchange) {
        throw new AppError(
          401,
          'INVALID_EXCHANGE_CODE',
          'Strava exchange code is invalid, expired, used, or belongs to another device',
        );
      }
      const [user] = await db.select().from(users).where(eq(users.id, exchange.userId)).limit(1);
      if (!user)
        throw new AppError(401, 'INVALID_EXCHANGE_CODE', 'Strava exchange code is invalid');
      const session = await createSession(user.id, body.deviceId);
      return reply.code(exchange.isNewUser ? 201 : 200).send({
        accessToken: session.accessToken,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        refreshToken: session.refreshToken,
        refreshTokenExpiresAt: session.refreshTokenExpiresAt,
        user: { id: user.id, displayName: user.displayName, email: user.email },
        isNewUser: exchange.isNewUser,
      });
    },
  );

  app.post(
    '/v1/integrations/strava/authorization',
    { preHandler: authenticate },
    async (request) => {
      const body = parseBody(stravaAuthorizationSchema, request);
      return createAuthorization(
        'link',
        request.auth.userId,
        request.auth.deviceId,
        body.redirectUri,
      );
    },
  );

  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      scope?: string;
      error?: string;
    };
  }>('/v1/integrations/strava/callback', async (request, reply) => {
    const { code, state: rawState, scope, error } = request.query;
    if (!rawState || rawState.length > 512) {
      throw new AppError(400, 'INVALID_OAUTH_STATE', 'Strava authorization state is invalid');
    }
    const [state] = await db
      .update(oauthStates)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oauthStates.stateHash, hashToken(rawState)),
          isNull(oauthStates.consumedAt),
          gt(oauthStates.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!state) {
      throw new AppError(
        400,
        'INVALID_OAUTH_STATE',
        'Strava authorization state is invalid, expired, or already used',
      );
    }
    if (error || !code) {
      return reply.redirect(redirectWith(state.redirectUri, { strava: 'denied' }));
    }
    if (code.length > 4096 || (scope?.length ?? 0) > 1000) {
      throw new AppError(400, 'INVALID_REQUEST', 'Strava callback parameters are too large');
    }

    const tokens = await exchangeStravaCode(code);
    const scopes = (scope ?? 'read').split(',').filter(Boolean);

    if (state.purpose === 'link') {
      if (!state.userId) throw new AppError(400, 'INVALID_OAUTH_STATE', 'Link state has no user');
      try {
        await db.transaction(async (tx) => {
          const [subjectIdentity, userIdentity, athleteConnection] = await Promise.all([
            tx
              .select()
              .from(authIdentities)
              .where(
                and(
                  eq(authIdentities.provider, 'strava'),
                  eq(authIdentities.providerSubject, tokens.athleteId),
                ),
              )
              .limit(1),
            tx
              .select()
              .from(authIdentities)
              .where(
                and(
                  eq(authIdentities.provider, 'strava'),
                  eq(authIdentities.userId, state.userId!),
                ),
              )
              .limit(1),
            tx
              .select()
              .from(stravaConnections)
              .where(eq(stravaConnections.athleteId, tokens.athleteId))
              .limit(1),
          ]);
          if (
            (subjectIdentity[0] && subjectIdentity[0].userId !== state.userId) ||
            (userIdentity[0] && userIdentity[0].providerSubject !== tokens.athleteId) ||
            (athleteConnection[0] && athleteConnection[0].userId !== state.userId)
          ) {
            throw new AppError(
              409,
              'IDENTITY_ALREADY_LINKED',
              'This Strava athlete belongs to another Runcast account',
            );
          }
          if (!userIdentity[0]) {
            await tx.insert(authIdentities).values({
              userId: state.userId!,
              provider: 'strava',
              providerSubject: tokens.athleteId,
            });
          }
          await tx
            .insert(stravaConnections)
            .values(connectionValues(state.userId!, tokens, scopes))
            .onConflictDoUpdate({
              target: stravaConnections.userId,
              set: {
                athleteId: tokens.athleteId,
                accessTokenEncrypted: encryptSecret(tokens.accessToken),
                refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
                expiresAt: tokens.expiresAt,
                scopes,
                updatedAt: new Date(),
              },
            });
        });
      } catch (caught) {
        if (caught instanceof AppError && caught.code === 'IDENTITY_ALREADY_LINKED') {
          await revokeStravaToken(tokens.accessToken).catch(() => {});
          return reply.redirect(
            redirectWith(state.redirectUri, { error: 'IDENTITY_ALREADY_LINKED' }),
          );
        }
        throw caught;
      }
      return reply.redirect(redirectWith(state.redirectUri, { strava: 'connected' }));
    }

    const exchangeCode = opaqueToken(32);
    const signIn = await db.transaction(async (tx) => {
      const [existingIdentity] = await tx
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.provider, 'strava'),
            eq(authIdentities.providerSubject, tokens.athleteId),
          ),
        )
        .limit(1);
      let userId: string;
      let isNewUser = false;
      if (existingIdentity) {
        userId = existingIdentity.userId;
        if (tokens.athleteDisplayName) {
          const [currentUser] = await tx
            .select({ displayName: users.displayName })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          if (currentUser && !currentUser.displayName) {
            await tx
              .update(users)
              .set({ displayName: tokens.athleteDisplayName, updatedAt: new Date() })
              .where(eq(users.id, userId));
          }
        }
      } else {
        const [candidate] = await tx
          .insert(users)
          .values({ displayName: tokens.athleteDisplayName })
          .returning();
        const inserted = await tx
          .insert(authIdentities)
          .values({
            userId: candidate.id,
            provider: 'strava',
            providerSubject: tokens.athleteId,
          })
          .onConflictDoNothing()
          .returning({ id: authIdentities.id });
        if (inserted.length) {
          userId = candidate.id;
          isNewUser = true;
          await tx.insert(preferences).values({ userId });
        } else {
          await tx.delete(users).where(eq(users.id, candidate.id));
          const [concurrent] = await tx
            .select({ userId: authIdentities.userId })
            .from(authIdentities)
            .where(
              and(
                eq(authIdentities.provider, 'strava'),
                eq(authIdentities.providerSubject, tokens.athleteId),
              ),
            )
            .limit(1);
          if (!concurrent)
            throw new AppError(409, 'IDENTITY_ALREADY_LINKED', 'Strava identity is linked');
          userId = concurrent.userId;
        }
      }

      await tx
        .insert(stravaConnections)
        .values(connectionValues(userId, tokens, scopes))
        .onConflictDoUpdate({
          target: stravaConnections.userId,
          set: {
            athleteId: tokens.athleteId,
            accessTokenEncrypted: encryptSecret(tokens.accessToken),
            refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
            expiresAt: tokens.expiresAt,
            scopes,
            updatedAt: new Date(),
          },
        });
      await tx.insert(stravaExchangeCodes).values({
        userId,
        codeHash: hashToken(exchangeCode),
        deviceId: state.deviceId,
        isNewUser,
        expiresAt: new Date(Date.now() + EXCHANGE_CODE_LIFETIME_MS),
      });
      return { userId, isNewUser };
    });
    void signIn;
    return reply.redirect(redirectWith(state.redirectUri, { code: exchangeCode }));
  });

  app.get('/v1/integrations/strava', { preHandler: authenticate }, async (request) => {
    const [connection] = await db
      .select()
      .from(stravaConnections)
      .where(eq(stravaConnections.userId, request.auth.userId))
      .limit(1);
    return connection
      ? { connected: true, athleteId: connection.athleteId, scopes: connection.scopes }
      : { connected: false, athleteId: null, scopes: [] };
  });

  app.delete('/v1/integrations/strava', { preHandler: authenticate }, async (request, reply) => {
    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, request.auth.userId));
    const stravaIdentity = identities.find((identity) => identity.provider === 'strava');
    if (stravaIdentity && identities.length === 1) {
      throw new AppError(
        409,
        'SOLE_IDENTITY',
        'Strava cannot be disconnected because it is the only sign-in method',
      );
    }
    const [connection] = await db
      .select()
      .from(stravaConnections)
      .where(eq(stravaConnections.userId, request.auth.userId))
      .limit(1);
    if (connection) await revokeStravaToken(decryptSecret(connection.accessTokenEncrypted));
    await db.transaction(async (tx) => {
      await tx.delete(stravaConnections).where(eq(stravaConnections.userId, request.auth.userId));
      await tx
        .delete(authIdentities)
        .where(
          and(
            eq(authIdentities.userId, request.auth.userId),
            eq(authIdentities.provider, 'strava'),
          ),
        );
    });
    return reply.code(204).send();
  });

  app.get('/v1/integrations/strava/routes', { preHandler: authenticate }, async (request) => {
    const connection = await connectionFor(request.auth.userId);
    const providerRoutes = await listStravaRoutes(decryptSecret(connection.accessTokenEncrypted));
    return { routes: providerRoutes };
  });

  app.post<{ Params: { stravaRouteId: string } }>(
    '/v1/routes/strava/:stravaRouteId/import',
    { preHandler: authenticate },
    async (request, reply) => {
      const body = parseBody(stravaImportSchema, request);
      const operation = `route:strava:${request.params.stravaRouteId}`;
      const replay = await replayIdempotent<ReturnType<typeof routeResponse>>(
        request.auth.userId,
        operation,
        body.idempotencyKey,
      );
      if (replay) return reply.code(200).send(replay);
      const connection = await connectionFor(request.auth.userId);
      const accessToken = decryptSecret(connection.accessTokenEncrypted);
      const available = await listStravaRoutes(accessToken);
      const selected = available.find((route) => route.id === request.params.stravaRouteId);
      if (!selected)
        throw new AppError(
          404,
          'STRAVA_ROUTE_NOT_FOUND',
          'Strava route was not found or is not a running route',
        );
      if (selected.private && !connection.scopes.includes('read_all')) {
        throw new AppError(
          403,
          'STRAVA_SCOPE_REQUIRED',
          'Private routes require Strava read_all access',
        );
      }
      const existing = await db.query.routes.findFirst({
        where: and(
          eq(routes.ownerId, request.auth.userId),
          eq(routes.source, 'strava'),
          eq(routes.providerId, selected.id),
        ),
      });
      const id = existing?.id ?? randomUUID();
      let planningRoute: PlanningRoute;
      try {
        planningRoute = parsePlanningGpx(
          await exportStravaRoute(accessToken, selected.id),
          id,
          selected.name,
        );
      } catch (caught) {
        throw new AppError(
          502,
          'STRAVA_GPX_INVALID',
          caught instanceof Error ? caught.message : 'Strava returned invalid GPX',
          caught instanceof PlanningGpxParseError
            ? { reason: caught.code, diagnostics: caught.diagnostics }
            : undefined,
        );
      }
      planningRoute = { ...planningRoute, name: selected.name };
      const route = adaptPlannableRouteV1(planningRoute);
      const result = await mutateIdempotently(
        request.auth.userId,
        operation,
        body.idempotencyKey,
        async (tx) => {
          const persisted = await persistRoute(
            {
              userId: request.auth.userId,
              source: 'strava',
              providerId: selected.id,
              route,
              planningRoute,
            },
            tx,
          );
          return {
            ...routeResponse(persisted.row),
            deduplicated: persisted.deduplicated || Boolean(existing),
          };
        },
      );
      return reply
        .code(result.replay || result.response.deduplicated ? 200 : 201)
        .send(result.response);
    },
  );
}
