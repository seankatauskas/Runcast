import { randomUUID } from 'node:crypto';
import { createGpxRouteSchema, updateRouteSchema, routeDescriptorSchema } from '@runcast/contracts';
import {
  adaptPlannableRouteV1,
  contentIdentity,
  PlanningGpxParseError,
  parsePlanningGpx,
  routeGeometryIdentity,
  unknownLegacyCoverageMask,
  type LegacyCoverageMask,
  type PlanningRoute,
  type LegacyRoute,
} from '@runcast/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../authenticate';
import { db } from '../db/client';
import { routes } from '../db/schema';
import { AppError } from '../errors';
import { iso, parseBody } from '../http';
import { mutateIdempotently, replayIdempotent, type MutationTransaction } from '../idempotency';
import { coordinateHash } from '../security/crypto';

import { planningRouteSection, planningWoodlandEvidence } from '../planning/bundle';

export function routeResponse(row: typeof routes.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    origin: row.source === 'strava' ? ('cloud-strava' as const) : ('cloud-gpx' as const),
    providerId: row.providerId,
    geometryIdentity:
      row.geometryIdentity ??
      (row.canonicalRouteV2 ? routeGeometryIdentity(row.canonicalRouteV2) : row.coordinateHash),
    distance: row.distance,
    importStatus: row.importStatus,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function ownedRoute(
  userId: string,
  routeId: string,
  database: typeof db | MutationTransaction = db,
): Promise<typeof routes.$inferSelect> {
  const [row] = await database
    .select()
    .from(routes)
    .where(and(eq(routes.id, routeId), eq(routes.ownerId, userId)))
    .limit(1);
  if (!row) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found');
  return row;
}

export async function persistRoute(
  input: {
    userId: string;
    source: 'gpx' | 'strava';
    providerId?: string;
    route: LegacyRoute;
    planningRoute?: PlanningRoute;
    coverage?: LegacyCoverageMask;
    timezone?: string;
  },
  tx: MutationTransaction,
): Promise<{ row: typeof routes.$inferSelect; deduplicated: boolean }> {
  // Serialize imports for an owner so distinct keys cannot race geometry deduplication.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 72736180))`);
  const coverage = input.coverage ?? unknownLegacyCoverageMask(input.route);
  const geometryIdentity = input.planningRoute
    ? routeGeometryIdentity(input.planningRoute)
    : contentIdentity(input.route.points.map(({ lat, lon, ele }) => [lat, lon, ele]));
  const [duplicate] = await tx
    .select()
    .from(routes)
    .where(and(eq(routes.ownerId, input.userId), eq(routes.geometryIdentity, geometryIdentity)))
    .limit(1);
  if (duplicate) return { row: duplicate, deduplicated: true };
  const [existingProviderRoute] = input.providerId
    ? await tx
        .select({ id: routes.id })
        .from(routes)
        .where(
          and(
            eq(routes.ownerId, input.userId),
            eq(routes.source, input.source),
            eq(routes.providerId, input.providerId),
          ),
        )
        .limit(1)
    : [];
  if (existingProviderRoute) {
    // A concurrent import may have assigned an ID while this request fetched the provider.
    input = {
      ...input,
      route: { ...input.route, id: existingProviderRoute.id },
      planningRoute: input.planningRoute
        ? { ...input.planningRoute, id: existingProviderRoute.id }
        : undefined,
    };
  }
  const [row] = await tx
    .insert(routes)
    .values({
      id: input.route.id,
      ownerId: input.userId,
      source: input.source,
      providerId: input.providerId,
      canonicalRoute: input.route,
      canonicalRouteV2: input.planningRoute,
      routeQualityV2: input.planningRoute?.quality,
      v2ContentIdentity: input.planningRoute ? contentIdentity(input.planningRoute) : undefined,
      geometryIdentity,
      name: input.route.name,
      distance: input.route.totalDistance,
      coverageMask: coverage,
      timezone: input.timezone ?? 'UTC',
      coordinateHash: coordinateHash(input.route.points),
    })
    .onConflictDoUpdate({
      target: [routes.ownerId, routes.source, routes.providerId],
      set: {
        canonicalRoute: input.route,
        ...(input.planningRoute
          ? {
              canonicalRouteV2: input.planningRoute,
              routeQualityV2: input.planningRoute.quality,
              v2ContentIdentity: contentIdentity(input.planningRoute),
            }
          : {}),
        name: input.route.name,
        distance: input.route.totalDistance,
        coverageMask: coverage,
        coordinateHash: coordinateHash(input.route.points),
        geometryIdentity,
        importStatus: 'ready',
        version: sql`${routes.version} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { row, deduplicated: Boolean(existingProviderRoute) };
}

export async function routeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/routes', { preHandler: authenticate }, async (request) => {
    const rows = await db
      .select()
      .from(routes)
      .where(eq(routes.ownerId, request.auth.userId))
      .orderBy(desc(routes.updatedAt));
    return { routes: rows.map(routeResponse) };
  });

  app.post('/v1/routes/gpx', { preHandler: authenticate }, async (request, reply) => {
    const body = parseBody(createGpxRouteSchema, request);
    const replay = await replayIdempotent<ReturnType<typeof routeResponse>>(
      request.auth.userId,
      'route:gpx',
      body.idempotencyKey,
    );
    if (replay) return reply.code(200).send(replay);
    const id = body.clientRouteId ?? randomUUID();
    let planningRoute: PlanningRoute;
    try {
      planningRoute = parsePlanningGpx(body.gpx, id, body.name ?? 'Imported route');
    } catch (error) {
      throw new AppError(
        422,
        'INVALID_GPX',
        error instanceof Error ? error.message : 'GPX could not be parsed',
        error instanceof PlanningGpxParseError
          ? { reason: error.code, diagnostics: error.diagnostics }
          : undefined,
      );
    }
    if (body.name) planningRoute = { ...planningRoute, name: body.name };
    const route = adaptPlannableRouteV1(planningRoute);
    const result = await mutateIdempotently(
      request.auth.userId,
      'route:gpx',
      body.idempotencyKey,
      async (tx) => {
        const persisted = await persistRoute(
          {
            userId: request.auth.userId,
            source: 'gpx',
            route,
            planningRoute,
            coverage: body.coverage,
          },
          tx,
        );
        return { ...routeResponse(persisted.row), deduplicated: persisted.deduplicated };
      },
    );
    return reply
      .code(result.replay || result.response.deduplicated ? 200 : 201)
      .send(result.response);
  });

  app.get<{ Params: { id: string } }>(
    '/v1/routes/:id/bundle',
    { preHandler: authenticate },
    async (request) => {
      await ownedRoute(request.auth.userId, request.params.id);
      throw new AppError(
        426,
        'CLIENT_UPDATE_REQUIRED',
        'Update Runcast to use current route planning',
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v2/routes/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const row = await ownedRoute(request.auth.userId, request.params.id);
      reply.header('cache-control', 'private, no-cache');
      return routeDescriptorSchema.parse({
        summary: routeResponse(row),
        timezone: row.timezone,
        route: planningRouteSection({
          id: row.id,
          route: row.canonicalRoute,
          planningRoute: row.canonicalRouteV2,
          coverage: row.coverageMask,
        }),
        woodlandEvidence: planningWoodlandEvidence(row.coverageMask),
      });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/v1/routes/:id',
    { preHandler: authenticate },
    async (request) => {
      const body = parseBody(updateRouteSchema, request);
      const operation = `route:rename:${request.params.id}`;
      const result = await mutateIdempotently(
        request.auth.userId,
        operation,
        body.idempotencyKey,
        async (tx) => {
          const current = await ownedRoute(request.auth.userId, request.params.id, tx);
          if (body.version !== undefined && body.version !== current.version) {
            throw new AppError(
              409,
              'ROUTE_VERSION_CONFLICT',
              'Route changed on another device',
              routeResponse(current),
            );
          }
          const [updated] = await tx
            .update(routes)
            .set({
              name: body.name,
              canonicalRoute: { ...current.canonicalRoute, name: body.name },
              canonicalRouteV2: current.canonicalRouteV2
                ? { ...current.canonicalRouteV2, name: body.name }
                : null,
              version: current.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(routes.id, current.id),
                eq(routes.ownerId, request.auth.userId),
                eq(routes.version, current.version),
              ),
            )
            .returning();
          if (!updated) {
            throw new AppError(
              409,
              'ROUTE_VERSION_CONFLICT',
              'Route changed on another device',
              routeResponse(await ownedRoute(request.auth.userId, request.params.id, tx)),
            );
          }
          return routeResponse(updated);
        },
      );
      return result.response;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/routes/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      await db
        .delete(routes)
        .where(and(eq(routes.id, request.params.id), eq(routes.ownerId, request.auth.userId)))
        .returning({ id: routes.id });
      // Deliberately idempotent: callers can safely replay an offline delete,
      // and ownership remains undisclosed for both absent and foreign IDs.
      return reply.code(204).send();
    },
  );
}
