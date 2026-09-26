import { randomUUID } from 'node:crypto';
import {
  planningBundleV2Schema,
  planningBundleV3Schema,
  recommendationV2Schema,
  recommendationV3Schema,
  type PlanningBundleV2,
  type PlanningBundleV3,
  type RecommendationV2,
  type RecommendationV3,
} from '@runcast/contracts';
import { contentIdentity } from '@runcast/core';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import {
  deviceInstallations,
  notificationDeliveries,
  notificationPublications,
  planningBundleArtifacts,
  recommendationEvaluations,
  routes,
  watches,
} from '../db/schema';
import { buildNotificationPayload } from '../notifications/payload';

export interface AppendEvaluationInput {
  routeId: string;
  watchId?: string | null;
  occurrenceDate?: string | null;
  predecessorId?: string | null;
  recommendation: RecommendationV2 | RecommendationV3;
  decisionTime: number;
  windowStart: number;
  windowEnd: number;
  minimumNoticeMs: number;
  expectedFlatSpeedMs?: number | null;
  bundle: PlanningBundleV2 | PlanningBundleV3 | null;
}

export type StoredEvaluation = typeof recommendationEvaluations.$inferSelect;
export type StoredPublication = typeof notificationPublications.$inferSelect;

/**
 * Append an exact evaluation snapshot. A retry with the same complete input
 * identity returns the existing row; no evaluation is ever updated.
 */
export async function appendRecommendationEvaluation(
  input: AppendEvaluationInput,
): Promise<StoredEvaluation> {
  const recommendation =
    input.recommendation.schemaVersion === 3
      ? (recommendationV3Schema.parse(input.recommendation) as RecommendationV3)
      : (recommendationV2Schema.parse(input.recommendation) as RecommendationV2);
  const bundle = input.bundle
    ? input.bundle.manifest.bundleSchemaVersion === 3
      ? (planningBundleV3Schema.parse(input.bundle) as PlanningBundleV3)
      : (planningBundleV2Schema.parse(input.bundle) as PlanningBundleV2)
    : null;
  const bundleHash = bundle ? contentIdentity(bundle) : null;
  const inputHash = contentIdentity({
    recommendationInputHash: recommendation.inputHash,
    planningBundleSnapshotHash: bundleHash,
    routeId: input.routeId,
    watchId: input.watchId ?? null,
    occurrenceDate: input.occurrenceDate ?? null,
    decisionTime: input.decisionTime,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    minimumNoticeMs: input.minimumNoticeMs,
    expectedFlatSpeedMs: input.expectedFlatSpeedMs ?? null,
  });
  const stored = await db.transaction(async (tx) => {
    let planningBundleId: string | null = null;
    if (bundle && bundleHash) {
      // GC skips pinned rows. If GC won before we took the lock, recreate the artifact.
      while (!planningBundleId) {
        const [artifact] = await tx
          .insert(planningBundleArtifacts)
          .values({ routeId: input.routeId, contentHash: bundleHash, snapshot: bundle })
          .onConflictDoNothing({
            target: [planningBundleArtifacts.routeId, planningBundleArtifacts.contentHash],
          })
          .returning();
        const [existing] = artifact
          ? [artifact]
          : await tx
              .select()
              .from(planningBundleArtifacts)
              .where(
                and(
                  eq(planningBundleArtifacts.routeId, input.routeId),
                  eq(planningBundleArtifacts.contentHash, bundleHash),
                ),
              )
              .for('key share')
              .limit(1);
        planningBundleId = existing?.id ?? null;
      }
    }
    const [inserted] = await tx
      .insert(recommendationEvaluations)
      .values({
        routeId: input.routeId,
        watchId: input.watchId ?? null,
        occurrenceDate: input.occurrenceDate ?? null,
        predecessorId: input.predecessorId ?? null,
        status: recommendation.status,
        winner: recommendation.winner,
        candidateAssessments: recommendation.candidates,
        decisionTime: new Date(input.decisionTime),
        windowStart: new Date(input.windowStart),
        windowEnd: new Date(input.windowEnd),
        minimumNoticeMs: input.minimumNoticeMs,
        versions: recommendation.versions,
        inputHash,
        planningBundleSnapshot: null,
        planningBundleId,
        expectedFlatSpeedMs: input.expectedFlatSpeedMs ?? null,
      })
      .onConflictDoNothing({ target: recommendationEvaluations.inputHash })
      .returning();
    if (inserted) return { ...inserted, planningBundleSnapshot: bundle };
    const existing = await tx.query.recommendationEvaluations.findFirst({
      where: eq(recommendationEvaluations.inputHash, inputHash),
    });
    if (!existing) throw new Error('Evaluation idempotency conflict could not be resolved');
    return existing;
  });
  // The unchanged input identity proves this is the exact parsed snapshot, including on replay.
  return { ...stored, planningBundleSnapshot: bundle };
}

export interface AppendPublicationInput {
  evaluationId: string;
  watchId?: string;
  occurrenceDate?: string;
  revision?: 1 | 2;
  publishedStart?: number;
  supersededPublicationId?: string | null;
  status: Exclude<RecommendationV2['status'], 'unavailable'>;
  title: string;
  body: string;
  deepLink: string;
  data: Record<string, unknown>;
}

/** Commit immutable publication copy and its device delivery intents together. */
export async function appendNotificationPublication(
  input: AppendPublicationInput,
): Promise<StoredPublication> {
  return db.transaction(async (tx) => {
    const evaluation = await tx.query.recommendationEvaluations.findFirst({
      where: eq(recommendationEvaluations.id, input.evaluationId),
    });
    if (!evaluation) throw new Error('Publication evaluation was not found');
    const watchId = input.watchId ?? evaluation.watchId;
    const occurrenceDate = input.occurrenceDate ?? evaluation.occurrenceDate;
    const revision = input.revision ?? null;
    if (watchId !== evaluation.watchId || occurrenceDate !== evaluation.occurrenceDate) {
      throw new Error('Publication occurrence does not match its evaluation');
    }
    if ((watchId === null) !== (occurrenceDate === null) || (revision !== null && !watchId)) {
      throw new Error('Watch publications require a watch and occurrence');
    }
    const winnerStart = evaluation.winner?.startTime ?? evaluation.windowStart.getTime();
    const [publication] = await tx
      .insert(notificationPublications)
      .values({
        evaluationId: input.evaluationId,
        watchId,
        occurrenceDate,
        revision,
        publishedStart:
          input.publishedStart === undefined && revision === null
            ? null
            : new Date(input.publishedStart ?? winnerStart),
        supersededPublicationId: input.supersededPublicationId ?? null,
        status: input.status,
        title: input.title,
        body: input.body,
        deepLink: input.deepLink,
        data: input.data,
      })
      // Both the evaluation and (watch, occurrence, revision) are idempotency keys.
      .onConflictDoNothing()
      .returning();
    if (!publication) {
      const existing = await tx.query.notificationPublications.findFirst({
        where: or(
          eq(notificationPublications.evaluationId, input.evaluationId),
          watchId && occurrenceDate && revision
            ? and(
                eq(notificationPublications.watchId, watchId),
                eq(notificationPublications.occurrenceDate, occurrenceDate),
                eq(notificationPublications.revision, revision),
              )
            : undefined,
        ),
      });
      if (!existing) throw new Error('Publication idempotency conflict could not be resolved');
      return existing;
    }
    if (watchId && occurrenceDate) {
      const [owned] = await tx
        .select({ watch: watches, route: routes })
        .from(watches)
        .innerJoin(routes, and(eq(routes.id, watches.routeId), eq(routes.ownerId, watches.userId)))
        .where(and(eq(watches.id, watchId), eq(routes.id, evaluation.routeId)))
        .for('no key update', { of: watches });
      if (!owned) throw new Error('Publication watch does not own its evaluated route');
      // Serialize enqueue with watch edits: disabling cancels every earlier intent,
      // and a publication racing after disable must not enqueue a new one.
      if (!owned.watch.enabled) return publication;
      const devices = await tx
        .select()
        .from(deviceInstallations)
        .where(
          and(
            eq(deviceInstallations.userId, owned.watch.userId),
            eq(deviceInstallations.enabled, true),
          ),
        );
      if (devices.length) {
        await tx.insert(notificationDeliveries).values(
          devices.map((device) => {
            const id = randomUUID();
            return {
              id,
              watchId,
              occurrenceDate,
              deviceId: device.id,
              publicationId: publication.id,
              payload: buildNotificationPayload({
                route: { id: owned.route.id, name: owned.route.name },
                watch: { id: watchId, occurrenceDate },
                delivery: { id },
                snapshot: { engine: 'planning-v2', id: evaluation.id, status: publication.status },
                startTime: winnerStart,
                url: publication.deepLink,
              }),
            };
          }),
        );
      }
    }
    return publication;
  });
}
