import {
  appleAuthRequestSchema,
  appleIdentityRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  type AuthProvider,
} from '@runcast/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../authenticate';
import { db } from '../db/client';
import {
  authIdentities,
  deletionAudits,
  preferences,
  sessions,
  stravaConnections,
  users,
} from '../db/schema';
import { AppError } from '../errors';
import { noStore, parseBody } from '../http';
import {
  destructiveAppleServerEvent,
  exchangeAppleCode,
  revokeAppleToken,
  verifyAppleIdentity,
  verifyAppleServerNotification,
} from '../providers/apple';
import { revokeStravaToken } from '../providers/strava';
import { decryptSecret, encryptSecret, hashToken } from '../security/crypto';
import { createSession, rotateSession } from '../session';

type User = typeof users.$inferSelect;

function publicUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
  };
}

async function providersFor(userId: string): Promise<AuthProvider[]> {
  const identities = await db
    .select({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId));
  const values = new Set(identities.map(({ provider }) => provider));
  return (['strava', 'apple'] as const).filter((provider) => values.has(provider));
}

async function authenticateApple(body: {
  identityToken: string;
  authorizationCode: string;
  nonce: string;
  displayName?: string;
  email?: string;
}) {
  const identity = await verifyAppleIdentity(body.identityToken, body.nonce);
  const appleTokens = await exchangeAppleCode(body.authorizationCode);
  const exchangedIdentity = await verifyAppleIdentity(appleTokens.idToken, body.nonce);
  if (exchangedIdentity.subject !== identity.subject) {
    throw new AppError(
      401,
      'APPLE_SUBJECT_MISMATCH',
      'Apple token endpoint identity did not match the sign-in identity',
    );
  }
  return {
    subject: identity.subject,
    email: identity.email,
    displayName: body.displayName ?? null,
    refreshTokenEncrypted: encryptSecret(appleTokens.refreshToken),
  };
}

async function findUserForIdentity(provider: AuthProvider, subject: string): Promise<User | null> {
  const [result] = await db
    .select({ user: users })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(and(eq(authIdentities.provider, provider), eq(authIdentities.providerSubject, subject)))
    .limit(1);
  return result?.user ?? null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/auth/apple',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      noStore(reply);
      const body = parseBody(appleAuthRequestSchema, request);
      const apple = await authenticateApple(body);
      const result = await db.transaction(async (tx) => {
        const [existingIdentity] = await tx
          .select()
          .from(authIdentities)
          .where(
            and(
              eq(authIdentities.provider, 'apple'),
              eq(authIdentities.providerSubject, apple.subject),
            ),
          )
          .limit(1);
        if (existingIdentity) {
          await tx
            .update(authIdentities)
            .set({
              providerRefreshTokenEncrypted: apple.refreshTokenEncrypted,
              updatedAt: new Date(),
            })
            .where(eq(authIdentities.id, existingIdentity.id));
          const [updated] = await tx
            .update(users)
            .set({
              ...(apple.displayName ? { displayName: apple.displayName } : {}),
              ...(apple.email ? { email: apple.email } : {}),
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingIdentity.userId))
            .returning();
          return { user: updated, isNewUser: false };
        }

        const [candidate] = await tx
          .insert(users)
          .values({ displayName: apple.displayName, email: apple.email })
          .returning();
        const inserted = await tx
          .insert(authIdentities)
          .values({
            userId: candidate.id,
            provider: 'apple',
            providerSubject: apple.subject,
            providerRefreshTokenEncrypted: apple.refreshTokenEncrypted,
          })
          .onConflictDoNothing()
          .returning({ id: authIdentities.id });
        if (inserted.length) {
          await tx.insert(preferences).values({ userId: candidate.id });
          return { user: candidate, isNewUser: true };
        }

        await tx.delete(users).where(eq(users.id, candidate.id));
        const [concurrent] = await tx
          .select({ user: users })
          .from(authIdentities)
          .innerJoin(users, eq(users.id, authIdentities.userId))
          .where(
            and(
              eq(authIdentities.provider, 'apple'),
              eq(authIdentities.providerSubject, apple.subject),
            ),
          )
          .limit(1);
        if (!concurrent) throw new AppError(409, 'IDENTITY_ALREADY_LINKED', 'Identity is linked');
        return { user: concurrent.user, isNewUser: false };
      });
      const tokens = await createSession(result.user.id, body.deviceId);
      return reply.code(result.isNewUser ? 201 : 200).send({
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        user: publicUser(result.user),
        isNewUser: result.isNewUser,
      });
    },
  );

  app.post(
    '/v1/auth/refresh',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      noStore(reply);
      const body = parseBody(refreshRequestSchema, request);
      const tokens = await rotateSession(body.refreshToken, body.deviceId);
      const [user] = await db.select().from(users).where(eq(users.id, tokens.userId)).limit(1);
      if (!user) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
      return {
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        user: publicUser(user),
        isNewUser: false,
      };
    },
  );

  app.post('/v1/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    noStore(reply);
    const body = parseBody(logoutRequestSchema, request);
    if (body.allDevices) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, request.auth.userId), isNull(sessions.revokedAt)));
    } else if (body.refreshToken) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.userId, request.auth.userId),
            eq(sessions.refreshTokenHash, hashToken(body.refreshToken)),
            isNull(sessions.revokedAt),
          ),
        );
    } else {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, request.auth.sessionId));
    }
    return reply.code(204).send();
  });

  app.get('/v1/me/identities', { preHandler: authenticate }, async (request, reply) => {
    noStore(reply);
    return { providers: await providersFor(request.auth.userId) };
  });

  app.post('/v1/me/identities/apple', { preHandler: authenticate }, async (request, reply) => {
    noStore(reply);
    const body = parseBody(appleIdentityRequestSchema, request);
    const apple = await authenticateApple(body);
    const wasLinked = await db.transaction(async (tx) => {
      const [subjectIdentity] = await tx
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.provider, 'apple'),
            eq(authIdentities.providerSubject, apple.subject),
          ),
        )
        .limit(1);
      if (subjectIdentity && subjectIdentity.userId !== request.auth.userId) {
        throw new AppError(
          409,
          'IDENTITY_ALREADY_LINKED',
          'This Apple identity belongs to another Runcast account',
        );
      }
      const [userIdentity] = await tx
        .select()
        .from(authIdentities)
        .where(
          and(eq(authIdentities.provider, 'apple'), eq(authIdentities.userId, request.auth.userId)),
        )
        .limit(1);
      if (userIdentity && userIdentity.providerSubject !== apple.subject) {
        throw new AppError(
          409,
          'IDENTITY_ALREADY_LINKED',
          'This account already has a different Apple identity',
        );
      }
      if (userIdentity) {
        await tx
          .update(authIdentities)
          .set({
            providerRefreshTokenEncrypted: apple.refreshTokenEncrypted,
            updatedAt: new Date(),
          })
          .where(eq(authIdentities.id, userIdentity.id));
      } else {
        await tx.insert(authIdentities).values({
          userId: request.auth.userId,
          provider: 'apple',
          providerSubject: apple.subject,
          providerRefreshTokenEncrypted: apple.refreshTokenEncrypted,
        });
      }
      await tx
        .update(users)
        .set({
          ...(apple.displayName ? { displayName: apple.displayName } : {}),
          ...(apple.email ? { email: apple.email } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, request.auth.userId));
      return Boolean(userIdentity);
    });
    return reply.code(wasLinked ? 200 : 201).send({
      providers: await providersFor(request.auth.userId),
    });
  });

  app.delete('/v1/me', { preHandler: authenticate }, async (request, reply) => {
    noStore(reply);
    const [user] = await db.select().from(users).where(eq(users.id, request.auth.userId)).limit(1);
    if (!user) return reply.code(204).send();
    const [connection, identities] = await Promise.all([
      db.query.stravaConnections.findFirst({
        where: eq(stravaConnections.userId, user.id),
      }),
      db.select().from(authIdentities).where(eq(authIdentities.userId, user.id)),
    ]);
    const apple = identities.find((identity) => identity.provider === 'apple');
    await Promise.allSettled([
      ...(connection ? [revokeStravaToken(decryptSecret(connection.accessTokenEncrypted))] : []),
      ...(apple?.providerRefreshTokenEncrypted
        ? [revokeAppleToken(decryptSecret(apple.providerRefreshTokenEncrypted))]
        : []),
    ]);
    await db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, user.id));
      await tx.insert(deletionAudits).values({ reason: 'user-requested' });
    });
    return reply.code(204).send();
  });

  app.post(
    '/v1/webhooks/apple',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const result =
        request.body && typeof request.body === 'object'
          ? (request.body as { signedPayload?: unknown })
          : {};
      if (typeof result.signedPayload !== 'string')
        throw new AppError(400, 'INVALID_REQUEST', 'signedPayload is required');
      const payload = await verifyAppleServerNotification(result.signedPayload);
      const event = destructiveAppleServerEvent(payload);
      if (event) {
        const user = await findUserForIdentity('apple', event.subject);
        if (user) {
          await db.transaction(async (tx) => {
            const identities = await tx
              .select({ id: authIdentities.id })
              .from(authIdentities)
              .where(eq(authIdentities.userId, user.id));
            await tx
              .update(sessions)
              .set({ revokedAt: new Date() })
              .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
            if (identities.length === 1) {
              await tx.delete(users).where(eq(users.id, user.id));
              await tx.insert(deletionAudits).values({ reason: 'apple-notification' });
            } else {
              await tx
                .delete(authIdentities)
                .where(
                  and(
                    eq(authIdentities.provider, 'apple'),
                    eq(authIdentities.providerSubject, event.subject),
                  ),
                );
            }
          });
        }
      }
      return reply.code(204).send();
    },
  );
}
