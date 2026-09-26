import {
  planningBundleV2Schema,
  planningBundleV3Schema,
  type PlanningBundleV2,
  type PlanningBundleV3,
} from '@runcast/contracts';
import { contentIdentity, type ForecastVariable } from '@runcast/core';
export const NOW = Date.parse('2026-07-18T15:00:00.000Z');
const VARIABLES: ForecastVariable[] = [
  'temperatureC',
  'feelsLikeC',
  'humidityPct',
  'windSpeedMs',
  'windDirectionFromDeg',
  'gustMs',
  'cloudCoverPct',
  'precipitationProbabilityPct',
  'precipitationMm',
  'weatherCode',
  'shortwaveRadiationWm2',
  'directNormalRadiationWm2',
  'diffuseRadiationWm2',
];

export function fixtureBundleV2(routeId = 'route-1'): PlanningBundleV2 {
  const values = Object.fromEntries(VARIABLES.map((variable) => [variable, [1, 1]]));
  const variables = Object.fromEntries(
    VARIABLES.map((variable) => [
      variable,
      { semantics: 'instant', unit: 'fixture', validRange: [-100, 2_000], required: true },
    ]),
  );
  const forecastBody = {
    schemaVersion: 2 as const,
    normalizationVersion: 'fixture-v2',
    provider: 'fixture',
    providerModel: null,
    providerRun: null,
    fetchId: 'fetch-fixture',
    fetchedAt: NOW,
    validFrom: NOW - 3_600_000,
    validUntil: NOW + 3_600_000,
    requestedCoordinates: [{ lat: 41.9, lon: -87.6 }],
    returnedCoordinates: [{ lat: 41.9, lon: -87.6 }],
    variables,
    anchors: [
      {
        lat: 41.9,
        lon: -87.6,
        routeDistanceM: 0,
        hourly: { time: [NOW - 3_600_000, NOW + 3_600_000], values },
      },
    ],
    missingCounts: Object.fromEntries(VARIABLES.map((variable) => [variable, 0])),
    reasons: [],
  };
  const forecast = { ...forecastBody, contentHash: contentIdentity(forecastBody) };
  const route = {
    schemaVersion: 2 as const,
    id: routeId,
    name: 'Lakefront',
    part: {
      points: [
        { lat: 41.9, lon: -87.6, elevationM: null },
        { lat: 41.91, lon: -87.59, elevationM: null },
      ],
    },
    cumulativeDistanceM: [0, 1_000],
    totalDistanceM: 1_000,
    quality: {
      schemaVersion: 2 as const,
      trackCount: 1,
      trackSegmentCount: 1,
      routeCount: 0,
      invalidPointCount: 0,
      duplicatePointCount: 0,
      missingElevationCount: 2,
      elevationStatus: 'absent' as const,
      reasons: ['route.elevation-absent'],
    },
  };
  const coverage = {
    schemaVersion: 2 as const,
    values: ['unknown'] as const,
    resolutionM: 50,
    source: 'fixture',
    fetchedAt: null,
    parserVersion: 'fixture-v2',
    completeness: 'unknown' as const,
    confidence: null,
    reasons: ['coverage.unknown'],
  };
  const routeSection = {
    schemaVersion: 2,
    contentHash: contentIdentity({ data: route }),
    data: route,
  };
  const environmentSection = {
    schemaVersion: 2,
    contentHash: contentIdentity({ coverage }),
    coverage,
  };
  const forecastSection = {
    schemaVersion: 2,
    contentHash: contentIdentity({ data: forecast }),
    data: forecast,
  };
  const versions = {
    route: 'route-v2',
    timing: 'flat-v1',
    weatherNormalizer: 'weather-v2',
    weatherSampler: 'weather-sampler-v2',
    exposure: 'exposure-v2',
    wind: 'wind-v2',
    physicalConditions: 'physical-v2',
    preference: 'conditions-v2',
    safety: 'safety-v2',
    recommendation: 'recommendation-v2',
    explanation: 'explanation-v2',
    build: 'fixture-build',
  };
  const bundleId = contentIdentity({
    route: routeSection.contentHash,
    environment: environmentSection.contentHash,
    forecast: forecastSection.contentHash,
    safetyContext: null,
    versions,
  });
  const manifestBody = {
    schemaVersion: 2,
    bundleSchemaVersion: 2 as const,
    bundleId,
    generatedAt: new Date(NOW).toISOString(),
    validFrom: new Date(NOW - 3_600_000).toISOString(),
    validUntil: new Date(NOW + 3_600_000).toISOString(),
    state: 'degraded' as const,
    evaluatorBuild: 'fixture-build',
    versions,
  };
  return planningBundleV2Schema.parse({
    manifest: { ...manifestBody, contentHash: contentIdentity(manifestBody) },
    route: routeSection,
    environment: environmentSection,
    forecast: forecastSection,
    safetyContext: null,
  });
}

export function fixtureBundleJson(): string {
  return JSON.stringify(fixtureBundleV3());
}

export function fixtureBundleV3(routeId = 'route-1'): PlanningBundleV3 {
  const v2 = fixtureBundleV2(routeId);
  const canopy = {
    schemaVersion: 3 as const,
    routeDistanceM: [0, 1_000],
    canopyPct: [40, 65],
    standardErrorPct: [4, 5],
    provider: 'usda-fs-science-tcc',
    region: 'conus' as const,
    datasetYear: 2025 as const,
    datasetVersion: 'v2025-6' as const,
    sourceResolutionM: 30 as const,
    acquiredAt: NOW,
    coordinateHash: 'fixture-geometry',
    completeness: 'complete' as const,
    reasons: [],
  };
  const environment = {
    schemaVersion: 3,
    contentHash: contentIdentity({ coverage: v2.environment.coverage, canopy }),
    coverage: v2.environment.coverage,
    canopy,
  };
  const versions = { ...v2.manifest.versions, canopy: 'canopy-v3', build: 'fixture-build-v3' };
  const bundleId = contentIdentity({
    route: v2.route.contentHash,
    environment: environment.contentHash,
    forecast: v2.forecast.contentHash,
    safetyContext: null,
    versions,
  });
  const manifestBody = {
    schemaVersion: 3,
    bundleSchemaVersion: 3 as const,
    bundleId,
    generatedAt: v2.manifest.generatedAt,
    validFrom: v2.manifest.validFrom,
    validUntil: v2.manifest.validUntil,
    state: 'degraded' as const,
    evaluatorBuild: 'fixture-build-v3',
    canopyModelMode: 'active' as const,
    versions,
  };
  return planningBundleV3Schema.parse({
    manifest: { ...manifestBody, contentHash: contentIdentity(manifestBody) },
    route: v2.route,
    environment,
    forecast: v2.forecast,
    safetyContext: null,
  });
}
