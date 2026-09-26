// Historical V2 fixture generation only; production serves current bundles.
import {
  planningBundleV2Schema,
  type PlanningBundleV2,
  type RecommendationV2,
} from '@runcast/contracts';
import {
  adaptLegacyRoute,
  contentIdentity,
  FORECAST_FRESHNESS_MS,
  PLANNING_ALGORITHM_VERSION_MANIFEST,
} from '@runcast/core';
import {
  planningWoodlandEvidence as legacyCoverageEvidence,
  type PlanningRouteRecord,
  type PreparedRouteForecast,
} from '../../planning/bundle';
function section<T>(schemaVersion: number, value: T) {
  return { schemaVersion, contentHash: contentIdentity(value), ...value };
}
export function assemblePlanningBundleV2(input: {
  route: PlanningRouteRecord;
  preparedForecast: PreparedRouteForecast;
  evaluatorBuild: string;
  now: number;
  freshnessMs?: number;
}): PlanningBundleV2 {
  const routeData = input.route.planningRoute ?? adaptLegacyRoute(input.route.route);
  const routeSection = section(2, { data: routeData });
  const coverage = legacyCoverageEvidence(input.route.coverage);
  const environmentSection = section(2, { coverage });
  const forecastSection = section(2, { data: input.preparedForecast.forecast });
  const freshnessMs = input.freshnessMs ?? FORECAST_FRESHNESS_MS;
  const state =
    routeData.quality.elevationStatus !== 'complete'
      ? 'degraded'
      : input.now - input.preparedForecast.fetchedAt > freshnessMs
        ? 'stale-within-validity'
        : 'ready';
  const bundleId = contentIdentity({
    route: routeSection.contentHash,
    environment: environmentSection.contentHash,
    forecast: forecastSection.contentHash,
    safetyContext: null,
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
  });
  const manifestBody = {
    schemaVersion: 2,
    bundleSchemaVersion: 2 as const,
    bundleId,
    generatedAt: new Date(input.preparedForecast.fetchedAt).toISOString(),
    validFrom: new Date(input.preparedForecast.validFrom).toISOString(),
    validUntil: new Date(input.preparedForecast.validUntil).toISOString(),
    state,
    evaluatorBuild: input.evaluatorBuild,
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
  };
  const bundle = {
    manifest: { ...manifestBody, contentHash: contentIdentity(manifestBody) },
    route: routeSection,
    environment: environmentSection,
    forecast: forecastSection,
    safetyContext: null,
  };
  return planningBundleV2Schema.parse(bundle);
}

/** Fixed historical payload fixture; tests exercise storage, never execute the retired evaluator. */
export function historicalRecommendation(now: number, bundleId: string): RecommendationV2 {
  const winner = {
    startTime: now,
    finishTime: now + 10 * 60_000,
    evaluable: true,
    safety: { tier: 'eligible' as const, policyVersion: 'fixture-v2', reasons: [] },
    conditionsFit: 0.8,
    plan: null,
    reasons: [],
  };
  const body = {
    schemaVersion: 2 as const,
    status: 'recommended' as const,
    winner,
    candidates: [winner],
    evaluatedCandidateCount: 1,
    unevaluableCandidateCount: 0,
    reasons: [],
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
    inputHash: contentIdentity({ now, bundleId }),
  };
  return { ...body, evaluationId: contentIdentity(body) };
}
