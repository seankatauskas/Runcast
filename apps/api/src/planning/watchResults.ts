import {
  watchResultDetailSchema,
  watchResultSummarySchema,
  type WatchResultDetail,
  type WatchResultSummary,
} from '@runcast/contracts';
import type { notificationPublications, recommendationEvaluations } from '../db/schema';
import type { DeliveryOutcomes } from '../notifications/outcomes';

type Evaluation = typeof recommendationEvaluations.$inferSelect;
type Publication = typeof notificationPublications.$inferSelect;

function forecastFetchedAt(evaluation: Evaluation): string | null {
  const fetchedAt = evaluation.planningBundleSnapshot?.forecast.data.fetchedAt;
  return typeof fetchedAt === 'number' && Number.isFinite(fetchedAt)
    ? new Date(fetchedAt).toISOString()
    : null;
}

function resultReasons(evaluation: Evaluation): string[] {
  if (evaluation.winner?.reasons?.length) {
    return [...new Set(evaluation.winner.reasons as string[])];
  }
  if (evaluation.status === 'no-suitable-window') return ['recommendation.no-suitable-window'];
  if (evaluation.status === 'unavailable') return ['recommendation.input-unavailable'];
  return [];
}

export function watchResultSummaryResponse(
  evaluation: Evaluation,
  publication: Publication | null,
  deliveryOutcomes?: DeliveryOutcomes,
): WatchResultSummary {
  if (!evaluation.watchId || !evaluation.occurrenceDate) {
    throw new TypeError('Watch result requires a watch and occurrence');
  }
  return watchResultSummarySchema.parse({
    evaluationId: evaluation.id,
    watchId: evaluation.watchId,
    occurrenceDate: evaluation.occurrenceDate,
    status: evaluation.status,
    recommendedStart:
      evaluation.winner && typeof evaluation.winner.startTime === 'number'
        ? new Date(evaluation.winner.startTime).toISOString()
        : null,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
    forecastFetchedAt: forecastFetchedAt(evaluation),
    reasonCodes: resultReasons(evaluation),
    notificationRevision: publication?.revision ?? 0,
    notifiedAt: deliveryOutcomes?.providerAcceptedAt ?? null,
  });
}

export function watchResultDetailResponse(
  evaluation: Evaluation,
  publication: Publication | null,
  fallbackSpeed: number,
  deliveryOutcomes?: DeliveryOutcomes,
): WatchResultDetail {
  return watchResultDetailSchema.parse({
    ...watchResultSummaryResponse(evaluation, publication, deliveryOutcomes),
    windowStart: evaluation.windowStart.toISOString(),
    windowEnd: evaluation.windowEnd.toISOString(),
    expectedFlatSpeedMs: evaluation.expectedFlatSpeedMs ?? fallbackSpeed,
    runPlan: evaluation.winner?.plan ?? null,
  });
}
