import { planningBundleV3Schema, type PlanningBundleV3 } from '@runcast/contracts';
import {
  adaptLegacyRoute,
  contentIdentity,
  FORECAST_FRESHNESS_MS,
  PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
  type CanopyEvidenceProfile,
  type CanopyModelMode,
  type LegacyCoverageMask,
  type NormalizedRouteForecast,
  type PlanningRoute,
  type LegacyRoute,
} from '@runcast/core';

/** Provider-normalized forecast ready to be assembled into a wire bundle. */
export interface PreparedRouteForecast {
  forecast: NormalizedRouteForecast;
  timezone: string;
  fetchedAt: number;
  validFrom: number;
  validUntil: number;
}

export function preparedRouteForecastFromForecast(
  forecast: NormalizedRouteForecast,
  timezone = 'UTC',
): PreparedRouteForecast {
  return {
    forecast,
    timezone,
    fetchedAt: forecast.fetchedAt,
    validFrom: forecast.validFrom,
    validUntil: forecast.validUntil,
  };
}

/** Persistence record mapped into the planning domain before serialization. */
export interface PlanningRouteRecord {
  id: string;
  route: LegacyRoute;
  planningRoute?: PlanningRoute | null;
  coverage: LegacyCoverageMask;
}

function section<T>(schemaVersion: number, value: T) {
  return { schemaVersion, contentHash: contentIdentity(value), ...value };
}

export function planningWoodlandEvidence(coverageMask: LegacyCoverageMask) {
  // V1 masks do not carry parser provenance. Do not reinterpret their open/tree
  // values as confident versioned evidence.
  return {
    schemaVersion: 2 as const,
    values: coverageMask.values.map(() => 'unknown' as const),
    resolutionM: coverageMask.resolution,
    source: 'legacy-v1-coverage',
    fetchedAt: null,
    parserVersion: 'legacy-unknown-v1',
    completeness: 'unknown' as const,
    confidence: null,
    reasons: ['coverage.unknown', 'coverage.incomplete'],
  };
}

/** Route identity shared by the forecast-independent descriptor and planning bundles. */
export function planningRouteSection(route: PlanningRouteRecord): PlanningBundleV3['route'] {
  return section(2, { data: route.planningRoute ?? adaptLegacyRoute(route.route) });
}

export function assemblePlanningBundleV3(input: {
  route: PlanningRouteRecord;
  preparedForecast: PreparedRouteForecast;
  canopy: CanopyEvidenceProfile;
  canopyModelMode: CanopyModelMode;
  evaluatorBuild: string;
  now: number;
  freshnessMs?: number;
}): PlanningBundleV3 {
  const routeSection = planningRouteSection(input.route);
  const routeData = routeSection.data;
  const environmentSection = section(3, {
    coverage: planningWoodlandEvidence(input.route.coverage),
    canopy: input.canopy,
  });
  const forecastSection = section(2, { data: input.preparedForecast.forecast });
  const freshnessMs = input.freshnessMs ?? FORECAST_FRESHNESS_MS;
  const state =
    routeData.quality.elevationStatus !== 'complete' || input.canopy.completeness !== 'complete'
      ? 'degraded'
      : input.now - input.preparedForecast.fetchedAt > freshnessMs
        ? 'stale-within-validity'
        : 'ready';
  const bundleId = contentIdentity({
    route: routeSection.contentHash,
    environment: environmentSection.contentHash,
    forecast: forecastSection.contentHash,
    safetyContext: null,
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
  });
  const manifestBody = {
    schemaVersion: 3,
    bundleSchemaVersion: 3 as const,
    bundleId,
    generatedAt: new Date(input.preparedForecast.fetchedAt).toISOString(),
    validFrom: new Date(input.preparedForecast.validFrom).toISOString(),
    validUntil: new Date(input.preparedForecast.validUntil).toISOString(),
    state,
    evaluatorBuild: input.evaluatorBuild,
    canopyModelMode: input.canopyModelMode,
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
  };
  const bundle = {
    manifest: { ...manifestBody, contentHash: contentIdentity(manifestBody) },
    route: routeSection,
    environment: environmentSection,
    forecast: forecastSection,
    safetyContext: null,
  };
  return planningBundleV3Schema.parse(bundle);
}
