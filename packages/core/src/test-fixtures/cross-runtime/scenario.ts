import { makeValidWeatherPayload, WEATHER_FIXTURE_T0 } from '../weather-fixtures';
import type { WoodlandEvidenceProfile, PlanningRoute } from '../../engine/planning/types';
import type { RawOpenMeteoLocation } from '../../engine/planning/weather';

export type CrossRuntimeScenario = 'benign' | 'missing-required-input' | 'thunderstorm';

export const CROSS_RUNTIME_WINDOW_START = WEATHER_FIXTURE_T0 + 10 * 60_000;
export const CROSS_RUNTIME_WINDOW_END = CROSS_RUNTIME_WINDOW_START + 60 * 60_000;

export const crossRuntimeRoute: PlanningRoute = {
  schemaVersion: 2,
  id: 'cross-runtime-route',
  name: 'Cross-runtime route',
  part: {
    points: [
      { lat: 41.9, lon: -87.6, elevationM: 180 },
      { lat: 41.905, lon: -87.595, elevationM: 184 },
      { lat: 41.91, lon: -87.59, elevationM: 181 },
    ],
  },
  cumulativeDistanceM: [0, 694.48, 1388.95],
  totalDistanceM: 1388.95,
  quality: {
    schemaVersion: 2,
    trackCount: 1,
    trackSegmentCount: 1,
    routeCount: 0,
    invalidPointCount: 0,
    duplicatePointCount: 0,
    missingElevationCount: 0,
    elevationStatus: 'complete',
    reasons: [],
  },
};

export const crossRuntimeCoverage: WoodlandEvidenceProfile = {
  schemaVersion: 2,
  values: ['no-mapped-woodland', 'mapped-woodland'],
  resolutionM: 1_000,
  source: 'cross-runtime-fixture',
  fetchedAt: WEATHER_FIXTURE_T0,
  parserVersion: 'fixture-v2',
  completeness: 'complete',
  confidence: 1,
  reasons: [],
};

export function crossRuntimeRawWeather(scenario: CrossRuntimeScenario): RawOpenMeteoLocation {
  const payload = makeValidWeatherPayload();
  payload.hourly.precipitation_probability = [0, 0, 0, 0];
  payload.hourly.precipitation = [0, 0, 0, 0];
  payload.hourly.weather_code = scenario === 'thunderstorm' ? [95, 95, 95, 95] : [1, 1, 1, 1];
  if (scenario === 'missing-required-input') {
    payload.hourly.temperature_2m = payload.hourly.temperature_2m.map(() => null);
  }
  return payload as unknown as RawOpenMeteoLocation;
}

export interface CrossRuntimeGolden {
  status: string;
  winnerStart: number | null;
  candidateStarts: number[];
  candidateReasons: string[][];
  conditionsFit: number | null;
  durationSeconds: number | null;
  radiationDoseJm2: number | null;
  evaluationId: string;
}

export interface CrossRuntimeDependencies {
  normalize: typeof import('../../engine/planning/weather').normalizeOpenMeteoForecast;
  evaluate: typeof import('../../engine/planning/pipeline').evaluateRunV3;
  recommend: typeof import('../../engine/planning/recommendation').recommendStartV3;
}

/** Dependency-injected so each test entry exercises its actual import surface. */
export function runCrossRuntimeScenario(
  dependencies: CrossRuntimeDependencies,
  scenario: CrossRuntimeScenario = 'benign',
): CrossRuntimeGolden {
  const forecast = dependencies.normalize(
    [crossRuntimeRawWeather(scenario)],
    [{ lat: 41.9, lon: -87.6, routeDistanceM: 0 }],
    { fetchId: `cross-runtime-${scenario}`, fetchedAt: WEATHER_FIXTURE_T0 },
  );
  const recommendation = dependencies.recommend({
    windowStart: CROSS_RUNTIME_WINDOW_START,
    windowEnd: CROSS_RUNTIME_WINDOW_END,
    decisionTime: CROSS_RUNTIME_WINDOW_START,
    minimumNoticeMs: 0,
    validFrom: forecast.validFrom,
    validUntil: forecast.validUntil,
    inputIdentity: { scenario, forecast: forecast.contentHash },
    evaluate: (startTime) =>
      dependencies.evaluate({
        route: crossRuntimeRoute,
        forecast,
        woodlandEvidence: crossRuntimeCoverage,
        startTime,
        expectedFlatSpeedMs: 3.03,
      }),
  });
  const winnerPlan = recommendation.winner?.plan ?? null;
  return {
    status: recommendation.status,
    winnerStart: recommendation.winner?.startTime ?? null,
    candidateStarts: recommendation.candidates.map((candidate) => candidate.startTime),
    candidateReasons: recommendation.candidates.map((candidate) => candidate.reasons),
    conditionsFit: recommendation.winner?.conditionsFit ?? null,
    durationSeconds: winnerPlan?.durationSeconds ?? null,
    radiationDoseJm2: winnerPlan?.physicalConditions.radiationDoseJm2 ?? null,
    evaluationId: recommendation.evaluationId,
  };
}
