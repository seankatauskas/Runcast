import {
  type PlanningBundleV3,
  type RecommendationV2,
  type RecommendationV3,
} from '@runcast/contracts';
import {
  evaluateRunV3,
  forecastIsFresh,
  contentIdentity,
  recommendStartV3,
  PLANNING_ALGORITHM_VERSION_MANIFEST,
  PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
  type WoodlandEvidenceProfile,
  type NormalizedRouteForecast,
  type PlanningRoute,
} from '@runcast/core';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, sql } from '../db/client';
import { config } from '../config';
import {
  notificationDeliveries,
  notificationPublications,
  recommendationEvaluations,
  routes,
  systemHeartbeats,
  watches,
} from '../db/schema';
import { assemblePlanningBundleV3, type PreparedRouteForecast } from '../planning/bundle';
import {
  appendNotificationPublication,
  appendRecommendationEvaluation,
} from '../planning/evaluations';
import {
  ForecastPreparationCoordinator,
  type OwnedPlanningRouteRecord,
  type RouteForecastRepository,
} from '../planning/service';
import {
  CanopyPreparationCoordinator,
  unknownCanopyForRoute,
  type RouteCanopyRepository,
} from '../planning/canopy';
import {
  PostgresRouteForecastRepository,
  PostgresRouteCanopyRepository,
} from '../planning/postgres';
import { OpenMeteoRouteForecastPreparer, UsdaRouteCanopyPreparer } from '../planning/runtime';
import { reconcileReceipts } from '../notifications/receipts';
import { notificationResultDeepLink } from '../notifications/payload';
import {
  drainPublicationDeliveries,
  type PublicationDeliveryDrainResult,
} from '../notifications/outbox';
import { pruneEvaluationStorage } from '../planning/evaluationStorage';
import { notificationBacklogMetrics } from '../notifications/outcomes';
import { logOperationalEvent } from '../observability';
import { occurrenceWithinLeadTime, upcomingOccurrences } from './occurrences';

type SchedulerRecommendation = RecommendationV2 | RecommendationV3;
type PublishableStatus = Exclude<SchedulerRecommendation['status'], 'unavailable'>;

export const REVISION_ACTIONABILITY_FLOOR_MS = 15 * 60_000;

/** Anchor scheduler actionability to its occurrence grid despite normal cron-second lateness. */
export function recommendationGridDecisionTime(now: number, windowStart: number): number {
  return (
    windowStart +
    Math.floor((now - windowStart) / REVISION_ACTIONABILITY_FLOOR_MS) *
      REVISION_ACTIONABILITY_FLOOR_MS
  );
}

export interface PublishedResultState {
  status: PublishableStatus;
  recommendedStart: number | null;
}

export type RevisionChange = 'updated-start' | 'conditions-changed';

/** The notification policy intentionally ignores score-only and small timing changes. */
export function qualifyingRevision(input: {
  previous: PublishedResultState;
  next: SchedulerRecommendation;
}): RevisionChange | null {
  if (input.next.status === 'unavailable') return null;
  const before = input.previous.recommendedStart;
  const after = input.next.winner?.startTime ?? null;
  if (before === null && after !== null) return 'updated-start';
  if (before !== null && after === null) return 'conditions-changed';
  if (before !== null && after !== null && Math.abs(after - before) >= 30 * 60_000) {
    return 'updated-start';
  }
  const rank: Record<PublishableStatus, number> = {
    recommended: 0,
    caution: 1,
    'no-suitable-window': 2,
  };
  return rank[input.next.status] > rank[input.previous.status] ? 'conditions-changed' : null;
}

export function revisionIsTimely(input: {
  now: number;
  originalStart: number | null;
  windowStart: number;
}): boolean {
  const reference = Math.min(input.originalStart ?? input.windowStart, input.windowStart);
  return input.now <= reference - REVISION_ACTIONABILITY_FLOOR_MS;
}

export function publicationDeliveryWindow(input: {
  recommendation: SchedulerRecommendation;
  windowStart: number;
  leadMinutes: number;
}): { opensAt: number; closesAt: number } | null {
  if (input.recommendation.status === 'unavailable') return null;
  const reference = input.recommendation.winner?.startTime ?? input.windowStart;
  return { opensAt: reference - input.leadMinutes * 60_000, closesAt: reference };
}

export function notificationCopy(input: {
  routeName: string;
  timezone: string;
  recommendation: SchedulerRecommendation;
  revision?: 1 | 2;
  change?: RevisionChange;
}): { title: string; body: string } | null {
  if (input.recommendation.status === 'unavailable') return null;
  if (input.recommendation.status === 'no-suitable-window') {
    return {
      title:
        input.revision === 2
          ? `Conditions changed for ${input.routeName}`
          : 'No suitable start window',
      body: `${input.routeName}: required conditions block this start window.`,
    };
  }
  const winner = input.recommendation.winner!;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(winner.startTime));
  if (input.revision === 2) {
    return input.change === 'updated-start'
      ? {
          title: `Updated start for ${input.routeName}`,
          body: `${time} · Review the latest forecast.`,
        }
      : {
          title: `Conditions changed for ${input.routeName}`,
          body: `${time} · Review the latest forecast conditions.`,
        };
  }
  return input.recommendation.status === 'caution'
    ? { title: `Caution for ${input.routeName}`, body: `${time} · Review the flagged conditions.` }
    : {
        title: `Recommended start for ${input.routeName}`,
        body: `${time} · Your route forecast is ready.`,
      };
}

interface SchedulerPlanningInput {
  route: OwnedPlanningRouteRecord;
  preparedForecast: PreparedRouteForecast;
  bundleV3: PlanningBundleV3;
}

export function forecastUsableForOccurrence(input: {
  preparedForecast: PreparedRouteForecast | null;
  windowStart: number;
  windowEnd: number;
  now: number;
}): boolean {
  return Boolean(
    input.preparedForecast &&
    forecastIsFresh(input.preparedForecast.fetchedAt, input.now) &&
    input.preparedForecast.validFrom <= input.windowEnd &&
    input.preparedForecast.validUntil >= input.windowStart,
  );
}

async function planningInputFor(
  item: { watch: typeof watches.$inferSelect; route: typeof routes.$inferSelect },
  windowStart: number,
  windowEnd: number,
  now: Date,
  repository: RouteForecastRepository,
  coordinator: ForecastPreparationCoordinator,
  canopyRepository: RouteCanopyRepository,
  canopyCoordinator: CanopyPreparationCoordinator,
): Promise<SchedulerPlanningInput | null> {
  const route = await repository.findOwnedRoute(item.watch.userId, item.route.id);
  if (!route) return null;
  let preparedForecast = await repository.findPreparedForecast(route.id);
  if (
    !forecastUsableForOccurrence({
      preparedForecast,
      windowStart,
      windowEnd,
      now: now.getTime(),
    })
  ) {
    preparedForecast = await coordinator.prepareAndWait(route, now.getTime());
  }
  if (
    !preparedForecast ||
    !forecastUsableForOccurrence({
      preparedForecast,
      windowStart,
      windowEnd,
      now: now.getTime(),
    })
  ) {
    return null;
  }
  const cachedCanopy = await canopyRepository.find(route);
  if (config.canopyModelMode === 'active') canopyCoordinator.start(route, now.getTime());
  const bundleV3 = assemblePlanningBundleV3({
    route,
    preparedForecast,
    canopy: cachedCanopy ?? unknownCanopyForRoute(route),
    canopyModelMode: config.canopyModelMode,
    // Preserve the existing scheduler artifact identity across runtime retirement.
    evaluatorBuild: PLANNING_ALGORITHM_VERSION_MANIFEST.build,
    now: now.getTime(),
  });
  return { route, preparedForecast, bundleV3 };
}

function unavailableRecommendation(input: {
  watchId: string;
  occurrenceDate: string;
  decisionTime: number;
  windowStart: number;
  windowEnd: number;
  minimumNoticeMs: number;
}): RecommendationV3 {
  const inputHash = contentIdentity({
    ...input,
    reason: 'recommendation.input-unavailable',
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
  });
  const body = {
    schemaVersion: 3 as const,
    status: 'unavailable' as const,
    winner: null,
    candidates: [],
    evaluatedCandidateCount: 0,
    unevaluableCandidateCount: 0,
    reasons: ['recommendation.input-unavailable'],
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
    inputHash,
  };
  return { ...body, evaluationId: contentIdentity(body) } as RecommendationV3;
}

export interface SchedulerResult {
  acquired: boolean;
  mode: 'current';
  evaluated: number;
  evaluationFailures: number;
  unavailableEvaluations: number;
  receiptFailures: number;
  receiptUnavailable: number;
  phaseFailures: string[];
  deliveries: PublicationDeliveryDrainResult;
  evaluationRetention?: Awaited<ReturnType<typeof pruneEvaluationStorage>>;
  deliveryMetrics?: Awaited<ReturnType<typeof notificationBacklogMetrics>>;
}

export async function runScheduler(
  now = new Date(),
  clock: () => Date = () => new Date(),
): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    acquired: false,
    mode: 'current',
    evaluated: 0,
    evaluationFailures: 0,
    unavailableEvaluations: 0,
    receiptFailures: 0,
    receiptUnavailable: 0,
    phaseFailures: [],
    deliveries: { attempted: 0, accepted: 0, expired: 0, failed: 0, errors: 0, cancelled: 0 },
  };
  const phase = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      result.phaseFailures.push(name);
      logOperationalEvent('error', 'watch.scheduler-phase-failed', { phase: name, error });
    }
  };
  const recordDeliveryResult = (deliveryResult: PublicationDeliveryDrainResult) => {
    for (const key of Object.keys(deliveryResult) as (keyof PublicationDeliveryDrainResult)[]) {
      result.deliveries[key] += deliveryResult[key];
    }
  };
  const drainDeliveries = async (publicationId?: string) => {
    recordDeliveryResult(await drainPublicationDeliveries(clock, publicationId));
  };
  await runWithSchedulerLock(new PostgresSchedulerLock(), async () => {
    result.acquired = true;
    await phase('delivery-retries', () => drainDeliveries());
    const active = await db
      .select({ watch: watches, route: routes })
      .from(watches)
      .innerJoin(routes, eq(routes.id, watches.routeId))
      .where(eq(watches.enabled, true));
    const planningRepository = new PostgresRouteForecastRepository();
    const preparationCoordinator = new ForecastPreparationCoordinator(
      planningRepository,
      new OpenMeteoRouteForecastPreparer(),
    );
    const canopyRepository = new PostgresRouteCanopyRepository();
    const canopyCoordinator = new CanopyPreparationCoordinator(
      canopyRepository,
      new UsdaRouteCanopyPreparer(),
    );
    try {
      for (const item of active) {
        const occurrences = upcomingOccurrences(item.watch, now);
        for (const occurrence of occurrences) {
          if (!occurrenceWithinLeadTime(occurrence, item.watch.leadMinutes, clock())) continue;
          try {
            const startedAt = Date.now();
            const windowStart = occurrence.windowStart.getTime();
            const windowEnd = occurrence.windowEnd.getTime();
            const published = await db
              .select({
                publication: notificationPublications,
                evaluation: recommendationEvaluations,
              })
              .from(notificationPublications)
              .innerJoin(
                recommendationEvaluations,
                eq(recommendationEvaluations.id, notificationPublications.evaluationId),
              )
              .where(
                and(
                  eq(notificationPublications.watchId, item.watch.id),
                  eq(notificationPublications.occurrenceDate, occurrence.date),
                  isNotNull(notificationPublications.revision),
                ),
              )
              .orderBy(desc(notificationPublications.revision));
            const initialPublication = published.find(
              ({ publication }) => publication.revision === 1,
            );
            const revisionPublication = published.find(
              ({ publication }) => publication.revision === 2,
            );
            const minimumNoticeMs = initialPublication
              ? REVISION_ACTIONABILITY_FLOOR_MS
              : item.watch.leadMinutes * 60_000;
            let planning: SchedulerPlanningInput | null = null;
            try {
              planning = await planningInputFor(
                item,
                windowStart,
                windowEnd,
                clock(),
                planningRepository,
                preparationCoordinator,
                canopyRepository,
                canopyCoordinator,
              );
            } catch (error) {
              logOperationalEvent('error', 'watch.forecast-unavailable', {
                watchId: item.watch.id,
                occurrenceDate: occurrence.date,
                error,
              });
            }
            const decisionTime = clock().getTime();
            const gridDecisionTime = recommendationGridDecisionTime(decisionTime, windowStart);
            const recommendation: RecommendationV3 = planning
              ? (recommendStartV3({
                  windowStart,
                  windowEnd,
                  decisionTime: gridDecisionTime,
                  minimumNoticeMs,
                  validFrom: planning.preparedForecast.validFrom,
                  validUntil: planning.preparedForecast.validUntil,
                  inputIdentity: planning.bundleV3,
                  evaluate: (startTime) =>
                    evaluateRunV3({
                      route: planning.bundleV3.route.data as PlanningRoute,
                      forecast: planning.bundleV3.forecast.data as NormalizedRouteForecast,
                      woodlandEvidence: planning.bundleV3.environment
                        .coverage as WoodlandEvidenceProfile,
                      canopyEvidence: planning.bundleV3.environment.canopy,
                      canopyModelMode: config.canopyModelMode,
                      startTime,
                      expectedFlatSpeedMs: item.watch.speed,
                    }),
                }) as unknown as RecommendationV3)
              : unavailableRecommendation({
                  watchId: item.watch.id,
                  occurrenceDate: occurrence.date,
                  decisionTime,
                  windowStart,
                  windowEnd,
                  minimumNoticeMs,
                });
            const planningBundle = planning?.bundleV3 ?? null;
            const [predecessor] = await db
              .select({ id: recommendationEvaluations.id })
              .from(recommendationEvaluations)
              .where(
                and(
                  eq(recommendationEvaluations.watchId, item.watch.id),
                  eq(recommendationEvaluations.occurrenceDate, occurrence.date),
                ),
              )
              .orderBy(desc(recommendationEvaluations.evaluatedAt))
              .limit(1);
            const evaluation = await appendRecommendationEvaluation({
              routeId: item.route.id,
              watchId: item.watch.id,
              occurrenceDate: occurrence.date,
              predecessorId: predecessor?.id ?? null,
              recommendation,
              decisionTime,
              windowStart,
              windowEnd,
              minimumNoticeMs,
              expectedFlatSpeedMs: item.watch.speed,
              bundle: planningBundle,
            });
            result.evaluated++;
            if (recommendation.status === 'unavailable') result.unavailableEvaluations++;
            const publicationTime = clock().getTime();
            let publicationId: string | null = null;
            let nextRevision: 1 | 2 | null = null;
            let revisionChange: RevisionChange | undefined;
            if (recommendation.status !== 'unavailable') {
              if (!initialPublication) {
                // Accepted pre-cutover legacy sends already fulfilled this occurrence.
                // Keep the new evaluation history but do not issue a second initial alert.
                const [legacyAccepted] = await db
                  .select({ id: notificationDeliveries.id })
                  .from(notificationDeliveries)
                  .where(
                    and(
                      eq(notificationDeliveries.watchId, item.watch.id),
                      eq(notificationDeliveries.occurrenceDate, occurrence.date),
                      isNull(notificationDeliveries.publicationId),
                      eq(notificationDeliveries.ticketState, 'ok'),
                    ),
                  )
                  .limit(1);
                const window = publicationDeliveryWindow({
                  recommendation,
                  windowStart,
                  leadMinutes: item.watch.leadMinutes,
                });
                if (
                  !legacyAccepted &&
                  window &&
                  publicationTime >= window.opensAt &&
                  publicationTime < window.closesAt
                ) {
                  nextRevision = 1;
                }
              } else if (!revisionPublication && config.watchRevisionMode !== 'off') {
                revisionChange =
                  qualifyingRevision({
                    previous: {
                      status: initialPublication.publication.status,
                      recommendedStart: initialPublication.evaluation.winner?.startTime ?? null,
                    },
                    next: recommendation,
                  }) ?? undefined;
                const timely = revisionIsTimely({
                  now: publicationTime,
                  originalStart: initialPublication.evaluation.winner?.startTime ?? null,
                  windowStart,
                });
                if (revisionChange) {
                  logOperationalEvent('info', 'watch.revision-decision', {
                    watchId: item.watch.id,
                    occurrenceDate: occurrence.date,
                    revisionMode: config.watchRevisionMode,
                    change: revisionChange,
                    timely,
                  });
                }
                if (revisionChange && timely && config.watchRevisionMode === 'active') {
                  nextRevision = 2;
                }
              }
            }
            if (nextRevision) {
              const copy = notificationCopy({
                routeName: item.route.name,
                timezone: item.watch.timezone,
                recommendation,
                revision: nextRevision,
                change: revisionChange,
              })!;
              const startTime = recommendation.winner?.startTime ?? windowStart;
              const deepLink = notificationResultDeepLink(item.watch.id, evaluation.id);
              const publication = await appendNotificationPublication({
                evaluationId: evaluation.id,
                watchId: item.watch.id,
                occurrenceDate: occurrence.date,
                revision: nextRevision,
                publishedStart: startTime,
                supersededPublicationId:
                  nextRevision === 2 ? initialPublication!.publication.id : null,
                status: recommendation.status as PublishableStatus,
                ...copy,
                deepLink,
                data: {
                  schemaVersion: 1,
                  type: 'watch-recommendation',
                  route: { id: item.route.id, name: item.route.name },
                  watch: { id: item.watch.id, occurrenceDate: occurrence.date },
                  revision: nextRevision,
                  publishedStart: new Date(startTime).toISOString(),
                  supersededPublicationId:
                    nextRevision === 2 ? initialPublication!.publication.id : null,
                  snapshot: {
                    engine: 'planning-v2',
                    id: evaluation.id,
                    status: recommendation.status,
                  },
                  start: new Date(startTime).toISOString(),
                  url: deepLink,
                },
              });
              publicationId = publication.id;
              await phase('publication-delivery', () => drainDeliveries(publication.id));
            }
            logOperationalEvent('info', 'watch.v2-evaluated', {
              watchId: item.watch.id,
              occurrenceDate: occurrence.date,
              evaluationId: evaluation.id,
              publicationId,
              status: recommendation.status,
              evaluatorVersion: recommendation.versions.recommendation,
              evaluatorLatencyMs: Date.now() - startedAt,
              bundleBytes: planningBundle ? Buffer.byteLength(JSON.stringify(planningBundle)) : 0,
              canopyModelMode: config.canopyModelMode,
              schedulerLatenessMs: Math.max(
                0,
                now.getTime() -
                  ((recommendation.winner?.startTime ?? windowStart) - minimumNoticeMs),
              ),
            });
          } catch (error) {
            result.evaluationFailures++;
            logOperationalEvent('error', 'watch.evaluation-failed', {
              watchId: item.watch.id,
              error,
            });
          }
        }
      }
    } finally {
      await phase('preparation-shutdown', async () => {
        const drained = await Promise.all([
          preparationCoordinator.close(),
          canopyCoordinator.close(),
        ]);
        if (drained.some((complete) => !complete))
          throw new Error('Preparation shutdown deadline exceeded');
      });
    }
    // Receipt-provider failure cannot prevent this run's evaluations and sends.
    await phase('receipts', async () => {
      const receipts = await reconcileReceipts(clock);
      result.receiptFailures = receipts.failures;
      result.receiptUnavailable = receipts.unavailable;
    });
    await phase('evaluation-retention', async () => {
      result.evaluationRetention = await pruneEvaluationStorage({
        now: clock(),
        retentionDays: config.evaluationRetentionDays,
      });
    });
    await phase('delivery-metrics', async () => {
      result.deliveryMetrics = await notificationBacklogMetrics(clock());
    });
    const completedAt = clock();
    await db
      .insert(systemHeartbeats)
      .values({
        name: 'watch-scheduler',
        lastSuccessAt: completedAt,
        details: { ...result, release: config.release },
      })
      .onConflictDoUpdate({
        target: systemHeartbeats.name,
        set: { lastSuccessAt: completedAt, details: { ...result, release: config.release } },
      });
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'watch.scheduler-rollout',
        ...result,
        release: config.release,
      }),
    );
  });
  return result;
}

export interface SchedulerLock {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

/** Test seam that also guarantees lock cleanup when scheduler work throws. */
export async function runWithSchedulerLock(
  lock: SchedulerLock,
  work: () => Promise<void>,
): Promise<boolean> {
  try {
    const acquired = await lock.acquire();
    if (!acquired) return false;
    await work();
    return true;
  } finally {
    await lock.release();
  }
}

/**
 * Session advisory lock: it serializes cron instances without keeping a
 * database transaction open across forecast or push-provider calls.
 */
export class PostgresSchedulerLock implements SchedulerLock {
  private connection: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  private acquired = false;

  async acquire(): Promise<boolean> {
    this.connection = await sql.reserve();
    const [row] = await this.connection<
      { acquired: boolean }[]
    >`select pg_try_advisory_lock(72736178) as acquired`;
    this.acquired = row.acquired;
    return this.acquired;
  }

  async release(): Promise<void> {
    const connection = this.connection;
    if (!connection) return;
    try {
      if (this.acquired) await connection`select pg_advisory_unlock(72736178)`;
    } finally {
      connection.release();
      this.connection = null;
      this.acquired = false;
    }
  }
}
