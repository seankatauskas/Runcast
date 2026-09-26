import {
  createWatchSchema,
  updateWatchSchema,
  watchListResponseSchema,
  watchResultDetailSchema,
  watchResultListResponseSchema,
  watchNotificationStatusSchema,
  watchSchema,
} from '@runcast/contracts';
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../authenticate';
import { db } from '../db/client';
import {
  idempotencyKeys,
  notificationPublications,
  planningBundleArtifacts,
  notificationDeliveries,
  recommendationEvaluations,
  watches,
} from '../db/schema';
import { AppError } from '../errors';
import { iso, parseBody } from '../http';
import { mutateIdempotently, replayIdempotent, type MutationTransaction } from '../idempotency';
import { nextOccurrence, weekdayNames } from '../jobs/occurrences';
import { logOperationalEvent } from '../observability';
import { watchResultDetailResponse, watchResultSummaryResponse } from '../planning/watchResults';
import { ownedRoute } from './routes';
import { publicationDeliveryOutcomes, summarizeDeliveryOutcomes } from '../notifications/outcomes';

import {
  CANCELLED_PUSH_TICKET_STATE,
  PUSH_WATCH_DISABLED,
  pendingDeliveryCondition,
} from '../notifications/delivery';

export const MAX_WATCHES_PER_USER = 20;

function assertTimezone(zone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
  } catch {
    throw new AppError(400, 'INVALID_TIMEZONE', 'timezone must be a valid IANA timezone');
  }
}

export function watchResponse(row: typeof watches.$inferSelect, now = new Date()) {
  const occurrence = row.enabled ? nextOccurrence(row, now) : null;
  return {
    id: row.id,
    routeId: row.routeId,
    weekdays: row.weekdays,
    timezone: row.timezone,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    speed: row.speed,
    leadMinutes: row.leadMinutes as 30 | 60 | 90,
    enabled: row.enabled,
    weekdayNames: weekdayNames(row.weekdays),
    nextOccurrence: occurrence
      ? {
          date: occurrence.date,
          windowStart: occurrence.windowStart.toISOString(),
          windowEnd: occurrence.windowEnd.toISOString(),
        }
      : null,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function ownedWatch(
  userId: string,
  id: string,
  database: typeof db | MutationTransaction = db,
): Promise<typeof watches.$inferSelect> {
  const [watch] = await database
    .select()
    .from(watches)
    .where(and(eq(watches.id, id), eq(watches.userId, userId)))
    .limit(1);
  if (!watch) throw new AppError(404, 'WATCH_NOT_FOUND', 'Watch was not found');
  return watch;
}

async function latestResultForOccurrence(watchId: string, occurrenceDate: string) {
  const [row] = await db
    .select({
      evaluation: recommendationEvaluations,
      publication: notificationPublications,
      bundleSnapshot: planningBundleArtifacts.snapshot,
    })
    .from(recommendationEvaluations)
    .leftJoin(
      planningBundleArtifacts,
      eq(planningBundleArtifacts.id, recommendationEvaluations.planningBundleId),
    )
    .leftJoin(
      notificationPublications,
      eq(notificationPublications.evaluationId, recommendationEvaluations.id),
    )
    .where(
      and(
        eq(recommendationEvaluations.watchId, watchId),
        eq(recommendationEvaluations.occurrenceDate, occurrenceDate),
      ),
    )
    .orderBy(desc(recommendationEvaluations.evaluatedAt), desc(recommendationEvaluations.id))
    .limit(1);
  if (!row) return null;
  return {
    publication: row.publication,
    evaluation: {
      ...row.evaluation,
      planningBundleSnapshot: row.evaluation.planningBundleSnapshot ?? row.bundleSnapshot,
    },
  };
}

async function recentWatchResults(watchId: string, limit: number) {
  const dates = await db
    .select({ occurrenceDate: recommendationEvaluations.occurrenceDate })
    .from(recommendationEvaluations)
    .where(
      and(
        eq(recommendationEvaluations.watchId, watchId),
        isNotNull(recommendationEvaluations.occurrenceDate),
      ),
    )
    .groupBy(recommendationEvaluations.occurrenceDate)
    .orderBy(desc(recommendationEvaluations.occurrenceDate))
    .limit(limit);
  const rows = await Promise.all(
    dates.map(({ occurrenceDate }) => latestResultForOccurrence(watchId, occurrenceDate as string)),
  );
  return summarizeWatchRows(rows);
}

async function summarizeWatchRows(
  rows: (Awaited<ReturnType<typeof latestResultForOccurrence>> | null)[],
) {
  const outcomes = await publicationDeliveryOutcomes(
    rows.flatMap((row) => (row?.publication ? [row.publication.id] : [])),
  );
  return rows.flatMap((row) =>
    row
      ? [
          watchResultSummaryResponse(
            row.evaluation,
            row.publication,
            row.publication ? outcomes.get(row.publication.id) : undefined,
          ),
        ]
      : [],
  );
}

async function watchEvaluation(watchId: string, evaluationId: string) {
  const [row] = await db
    .select({
      evaluation: recommendationEvaluations,
      publication: notificationPublications,
      bundleSnapshot: planningBundleArtifacts.snapshot,
    })
    .from(recommendationEvaluations)
    .leftJoin(
      planningBundleArtifacts,
      eq(planningBundleArtifacts.id, recommendationEvaluations.planningBundleId),
    )
    .leftJoin(
      notificationPublications,
      eq(notificationPublications.evaluationId, recommendationEvaluations.id),
    )
    .where(
      and(
        eq(recommendationEvaluations.id, evaluationId),
        eq(recommendationEvaluations.watchId, watchId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError(404, 'WATCH_RESULT_NOT_FOUND', 'Watch result was not found');
  return {
    publication: row.publication,
    evaluation: {
      ...row.evaluation,
      planningBundleSnapshot: row.evaluation.planningBundleSnapshot ?? row.bundleSnapshot,
    },
  };
}

export async function watchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/watches', { preHandler: authenticate }, async (request) => {
    const rows = await db
      .select()
      .from(watches)
      .where(eq(watches.userId, request.auth.userId))
      .orderBy(desc(watches.updatedAt));
    const now = new Date();
    const responses = rows.map((row) => watchResponse(row, now));
    const latest = await Promise.all(
      responses.map(async (watch) => {
        if (!watch.nextOccurrence) return null;
        return latestResultForOccurrence(watch.id, watch.nextOccurrence.date);
      }),
    );
    return watchListResponseSchema.parse({
      watches: responses,
      latestResults: await summarizeWatchRows(latest),
    });
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/v1/watches/:id/results',
    { preHandler: authenticate },
    async (request) => {
      const startedAt = Date.now();
      const watch = await ownedWatch(request.auth.userId, request.params.id);
      const rawLimit = request.query.limit === undefined ? 7 : Number(request.query.limit);
      if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 7) {
        throw new AppError(400, 'INVALID_REQUEST', 'limit must be an integer from 1 through 7');
      }
      const response = watchResultListResponseSchema.parse({
        results: await recentWatchResults(watch.id, rawLimit),
      });
      logOperationalEvent('info', 'watch.results-listed', {
        watchId: watch.id,
        resultCount: response.results.length,
        latencyMs: Date.now() - startedAt,
      });
      return response;
    },
  );

  app.get<{ Params: { id: string; evaluationId: string } }>(
    '/v1/watches/:id/results/:evaluationId',
    { preHandler: authenticate },
    async (request) => {
      const startedAt = Date.now();
      const watch = await ownedWatch(request.auth.userId, request.params.id);
      const row = await watchEvaluation(watch.id, request.params.evaluationId);
      const outcomes = await publicationDeliveryOutcomes(
        row.publication ? [row.publication.id] : [],
      );
      const response = watchResultDetailSchema.parse(
        watchResultDetailResponse(
          row.evaluation,
          row.publication,
          watch.speed,
          row.publication ? outcomes.get(row.publication.id) : undefined,
        ),
      );
      logOperationalEvent('info', 'watch.result-opened', {
        watchId: watch.id,
        evaluationId: response.evaluationId,
        status: response.status,
        latencyMs: Date.now() - startedAt,
      });
      return response;
    },
  );

  app.get<{ Params: { id: string; evaluationId: string } }>(
    '/v1/watches/:id/results/:evaluationId/notification',
    { preHandler: authenticate },
    async (request) => {
      const watch = await ownedWatch(request.auth.userId, request.params.id);
      const row = await watchEvaluation(watch.id, request.params.evaluationId);
      const outcomes = await publicationDeliveryOutcomes(
        row.publication ? [row.publication.id] : [],
      );
      return watchNotificationStatusSchema.parse({
        evaluationId: row.evaluation.id,
        publicationId: row.publication?.id ?? null,
        publishedAt: row.publication?.createdAt.toISOString() ?? null,
        ...(row.publication ? outcomes.get(row.publication.id)! : summarizeDeliveryOutcomes([])),
      });
    },
  );

  app.post('/v1/watches', { preHandler: authenticate }, async (request, reply) => {
    const body = parseBody(createWatchSchema, request);
    const replay = await replayIdempotent<ReturnType<typeof watchResponse>>(
      request.auth.userId,
      'watch:create',
      body.idempotencyKey,
    );
    if (replay) {
      return reply.code(200).send(watchResponse(await ownedWatch(request.auth.userId, replay.id)));
    }
    await ownedRoute(request.auth.userId, body.routeId);
    assertTimezone(body.timezone);
    const created = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${request.auth.userId}, 72736178))`,
      );
      if (body.idempotencyKey) {
        const [stored] = await tx
          .select({ response: idempotencyKeys.response })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, request.auth.userId),
              eq(idempotencyKeys.operation, 'watch:create'),
              eq(idempotencyKeys.key, body.idempotencyKey),
            ),
          )
          .limit(1);
        if (stored) {
          return {
            replay: true as const,
            response: stored.response as ReturnType<typeof watchResponse>,
          };
        }
      }
      const [watchCount] = await tx
        .select({ value: count() })
        .from(watches)
        .where(eq(watches.userId, request.auth.userId));
      if (watchCount.value >= MAX_WATCHES_PER_USER) {
        throw new AppError(
          409,
          'WATCH_LIMIT_REACHED',
          `A maximum of ${MAX_WATCHES_PER_USER} watches is allowed`,
        );
      }
      const [row] = await tx
        .insert(watches)
        .values({
          userId: request.auth.userId,
          routeId: body.routeId,
          weekdays: body.weekdays,
          timezone: body.timezone,
          startMinutes: body.startMinutes,
          endMinutes: body.endMinutes,
          speed: body.speed,
          leadMinutes: body.leadMinutes,
          enabled: body.enabled,
        })
        .returning();
      const response = watchResponse(row);
      if (body.idempotencyKey) {
        await tx.insert(idempotencyKeys).values({
          userId: request.auth.userId,
          operation: 'watch:create',
          key: body.idempotencyKey,
          response,
        });
      }
      return { replay: false as const, response };
    });
    if (!created.replay) {
      logOperationalEvent('info', 'watch.created', {
        watchId: created.response.id,
        enabled: created.response.enabled,
      });
    }
    return reply.code(created.replay ? 200 : 201).send(created.response);
  });

  app.patch<{ Params: { id: string } }>(
    '/v1/watches/:id',
    { preHandler: authenticate },
    async (request) => {
      const body = parseBody(updateWatchSchema, request);
      const result = await mutateIdempotently(
        request.auth.userId,
        `watch:update:${request.params.id}`,
        body.idempotencyKey,
        async (tx) => {
          const current = await ownedWatch(request.auth.userId, request.params.id, tx);
          if (body.version !== current.version) {
            throw new AppError(
              409,
              'VERSION_CONFLICT',
              'Watch changed on another device',
              watchResponse(current),
            );
          }
          const candidate = {
            ...current,
            ...body,
          };
          const valid = watchSchema.safeParse(watchResponse(candidate));
          if (!valid.success)
            throw new AppError(400, 'INVALID_REQUEST', 'Watch is invalid', valid.error.flatten());
          assertTimezone(candidate.timezone);
          const [row] = await tx
            .update(watches)
            .set({
              ...(body.weekdays === undefined ? {} : { weekdays: body.weekdays }),
              ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
              ...(body.startMinutes === undefined ? {} : { startMinutes: body.startMinutes }),
              ...(body.endMinutes === undefined ? {} : { endMinutes: body.endMinutes }),
              ...(body.speed === undefined ? {} : { speed: body.speed }),
              ...(body.leadMinutes === undefined ? {} : { leadMinutes: body.leadMinutes }),
              ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
              version: current.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(watches.id, current.id),
                eq(watches.userId, request.auth.userId),
                eq(watches.version, body.version),
              ),
            )
            .returning();
          if (!row)
            throw new AppError(
              409,
              'VERSION_CONFLICT',
              'Watch changed on another device',
              watchResponse(await ownedWatch(request.auth.userId, request.params.id, tx)),
            );
          if (body.enabled === false) {
            await tx
              .update(notificationDeliveries)
              .set({
                ticketState: CANCELLED_PUSH_TICKET_STATE,
                lastError: PUSH_WATCH_DISABLED,
                updatedAt: new Date(),
              })
              .where(and(eq(notificationDeliveries.watchId, row.id), pendingDeliveryCondition()));
          }
          return watchResponse(row);
        },
      );
      return result.response;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/watches/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const deleted = await db
        .delete(watches)
        .where(and(eq(watches.id, request.params.id), eq(watches.userId, request.auth.userId)))
        .returning({ id: watches.id });
      if (!deleted.length) throw new AppError(404, 'WATCH_NOT_FOUND', 'Watch was not found');
      return reply.code(204).send();
    },
  );
}
