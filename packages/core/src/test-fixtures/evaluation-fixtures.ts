/** Test-only fixtures shared by wind, conditions, safety, and recommendation tests. */

export const EVALUATION_MINUTE_MS = 60_000;
export const EVALUATION_GRID_MS = 15 * EVALUATION_MINUTE_MS;
export const EVALUATION_T0 = Date.UTC(2026, 6, 18, 13, 7, 0);

export interface EvaluationRoutePointFixture {
  lat: number;
  lon: number;
  elevationM: number | null;
}

export interface EvaluationRouteFixture {
  id: string;
  points: EvaluationRoutePointFixture[];
  elevationStatus: 'complete' | 'partial' | 'absent' | 'legacy-unknown';
}

export function reverseRouteFixture(route: EvaluationRouteFixture): EvaluationRouteFixture {
  return {
    ...route,
    id: `${route.id}-reversed`,
    points: [...route.points].reverse(),
  };
}

export const eastboundRouteFixture: EvaluationRouteFixture = {
  id: 'eastbound-1km',
  elevationStatus: 'complete',
  points: [
    { lat: 41.9, lon: -87.6, elevationM: 180 },
    { lat: 41.9, lon: -87.594, elevationM: 182 },
    { lat: 41.9, lon: -87.588, elevationM: 180 },
  ],
};

export const westboundRouteFixture = reverseRouteFixture(eastboundRouteFixture);

export interface WindVectorFixture {
  description: string;
  routeBearingDeg: number;
  runnerSpeedMps: number;
  ambientSpeedMps: number;
  meteorologicalFromDeg: number;
  expected: {
    ambientAlongMps: number;
    ambientCrossMps: number;
    apparentAirSpeedMps: number;
    oppositionDelta: number;
  };
}

export const windVectorFixtures = {
  stillAir: {
    description:
      'runner motion creates apparent airflow but no opposition delta relative to still air',
    routeBearingDeg: 90,
    runnerSpeedMps: 4,
    ambientSpeedMps: 0,
    meteorologicalFromDeg: 0,
    expected: {
      ambientAlongMps: 0,
      ambientCrossMps: 0,
      apparentAirSpeedMps: 4,
      oppositionDelta: 0,
    },
  },
  directHeadwind: {
    description: 'wind from the direction of travel adds to apparent airflow',
    routeBearingDeg: 90,
    runnerSpeedMps: 4,
    ambientSpeedMps: 5,
    meteorologicalFromDeg: 90,
    expected: {
      ambientAlongMps: 5,
      ambientCrossMps: 0,
      apparentAirSpeedMps: 9,
      oppositionDelta: 65,
    },
  },
  followingMatchesPace: {
    description: 'following ambient flow equal to pace makes apparent airflow approach zero',
    routeBearingDeg: 90,
    runnerSpeedMps: 4,
    ambientSpeedMps: 4,
    meteorologicalFromDeg: 270,
    expected: {
      ambientAlongMps: -4,
      ambientCrossMps: 0,
      apparentAirSpeedMps: 0,
      oppositionDelta: -16,
    },
  },
  pureCrosswind: {
    description: 'crosswind retains sign and increases apparent-air magnitude by vector addition',
    routeBearingDeg: 90,
    runnerSpeedMps: 4,
    ambientSpeedMps: 3,
    meteorologicalFromDeg: 0,
    expected: {
      ambientAlongMps: 0,
      ambientCrossMps: -3,
      apparentAirSpeedMps: 5,
      oppositionDelta: 4,
    },
  },
} as const satisfies Record<string, WindVectorFixture>;

export interface HazardPolicyFixture {
  description: string;
  inputs: { weatherCode: number; precipitationMm: number; feelsLikeC: number; gustMps: number };
  expected: { safety: 'eligible' | 'caution' | 'ineligible'; reasons: string[] };
}

export const hazardPolicyFixtures = {
  benign: {
    description: 'no modeled threshold fires',
    inputs: { weatherCode: 1, precipitationMm: 0, feelsLikeC: 20, gustMps: 3 },
    expected: { safety: 'eligible', reasons: [] },
  },
  thunderstorm: {
    description: 'thunderstorm codes hard-block selection regardless of preference utility',
    inputs: { weatherCode: 95, precipitationMm: 0, feelsLikeC: 20, gustMps: 3 },
    expected: { safety: 'ineligible', reasons: ['THUNDERSTORM'] },
  },
  heavyRain: {
    description: 'heavy rain is caution, not a hard block',
    inputs: { weatherCode: 65, precipitationMm: 9, feelsLikeC: 20, gustMps: 3 },
    expected: { safety: 'caution', reasons: ['HEAVY_RAIN'] },
  },
  extremeHeatBoundary: {
    description: '35 C feels-like is the inclusive caution boundary',
    inputs: { weatherCode: 1, precipitationMm: 0, feelsLikeC: 35, gustMps: 3 },
    expected: { safety: 'caution', reasons: ['EXTREME_HEAT'] },
  },
  highWindBoundary: {
    description: '17 m/s gust is the inclusive caution boundary',
    inputs: { weatherCode: 1, precipitationMm: 0, feelsLikeC: 20, gustMps: 17 },
    expected: { safety: 'caution', reasons: ['HIGH_WIND'] },
  },
  multipleCautions: {
    description: 'caution reasons accumulate without becoming preference-compensable',
    inputs: { weatherCode: 65, precipitationMm: 9, feelsLikeC: 36, gustMps: 18 },
    expected: {
      safety: 'caution',
      reasons: ['HEAVY_RAIN', 'EXTREME_HEAT', 'HIGH_WIND'],
    },
  },
} as const satisfies Record<string, HazardPolicyFixture>;

export interface CandidateAssessmentFixture {
  startTime: number;
  finishTime: number | null;
  evaluation: 'evaluated' | 'unevaluable';
  safety: 'eligible' | 'caution' | 'ineligible' | 'unknown';
  conditionsFit: number | null;
  reasons: string[];
}

export interface RecommendationScenarioFixture {
  description: string;
  windowStart: number;
  windowEnd: number;
  decisionTime: number;
  minimumNoticeMs: number;
  validFrom: number;
  validThrough: number;
  assessments: CandidateAssessmentFixture[];
  expected: {
    status: 'recommended' | 'caution' | 'no-suitable-window' | 'unavailable';
    winnerStart: number | null;
  };
}

const slot0 = EVALUATION_T0;
const slot1 = slot0 + EVALUATION_GRID_MS;
const slot2 = slot1 + EVALUATION_GRID_MS;
const validThrough = slot2 + 2 * EVALUATION_GRID_MS;

export const recommendationScenarioFixtures = {
  eligibleOutranksCaution: {
    description: 'an eligible candidate outranks a higher-utility caution candidate',
    windowStart: slot0,
    windowEnd: slot2,
    decisionTime: slot0,
    minimumNoticeMs: 0,
    validFrom: slot0,
    validThrough,
    assessments: [
      {
        startTime: slot0,
        finishTime: slot1,
        evaluation: 'evaluated',
        safety: 'caution',
        conditionsFit: 0.99,
        reasons: ['HIGH_WIND'],
      },
      {
        startTime: slot1,
        finishTime: slot2,
        evaluation: 'evaluated',
        safety: 'eligible',
        conditionsFit: 0.7,
        reasons: [],
      },
    ],
    expected: { status: 'recommended', winnerStart: slot1 },
  },
  cautionOnly: {
    description: 'a selectable caution is returned when no eligible candidate exists',
    windowStart: slot0,
    windowEnd: slot2,
    decisionTime: slot0,
    minimumNoticeMs: 0,
    validFrom: slot0,
    validThrough,
    assessments: [
      {
        startTime: slot0,
        finishTime: slot1,
        evaluation: 'evaluated',
        safety: 'ineligible',
        conditionsFit: 1,
        reasons: ['THUNDERSTORM'],
      },
      {
        startTime: slot1,
        finishTime: slot2,
        evaluation: 'evaluated',
        safety: 'caution',
        conditionsFit: 0.6,
        reasons: ['HEAVY_RAIN'],
      },
    ],
    expected: { status: 'caution', winnerStart: slot1 },
  },
  allIneligible: {
    description:
      'only fully evaluated, entirely ineligible candidates establish no-suitable-window',
    windowStart: slot0,
    windowEnd: slot1,
    decisionTime: slot0,
    minimumNoticeMs: 0,
    validFrom: slot0,
    validThrough,
    assessments: [
      {
        startTime: slot0,
        finishTime: slot1,
        evaluation: 'evaluated',
        safety: 'ineligible',
        conditionsFit: 0.9,
        reasons: ['THUNDERSTORM'],
      },
      {
        startTime: slot1,
        finishTime: slot2,
        evaluation: 'evaluated',
        safety: 'ineligible',
        conditionsFit: 0.8,
        reasons: ['THUNDERSTORM'],
      },
    ],
    expected: { status: 'no-suitable-window', winnerStart: null },
  },
  unresolvedCandidate: {
    description: 'one unresolved input prevents an all-ineligible conclusion',
    windowStart: slot0,
    windowEnd: slot1,
    decisionTime: slot0,
    minimumNoticeMs: 0,
    validFrom: slot0,
    validThrough,
    assessments: [
      {
        startTime: slot0,
        finishTime: slot1,
        evaluation: 'evaluated',
        safety: 'ineligible',
        conditionsFit: 0.9,
        reasons: ['THUNDERSTORM'],
      },
      {
        startTime: slot1,
        finishTime: null,
        evaluation: 'unevaluable',
        safety: 'unknown',
        conditionsFit: null,
        reasons: ['WEATHER_REQUIRED_FIELD_MISSING'],
      },
    ],
    expected: { status: 'unavailable', winnerStart: null },
  },
  stableUtilityTie: {
    description: 'utilities within 0.01 tie and resolve to the earliest timestamp',
    windowStart: slot0,
    windowEnd: slot1,
    decisionTime: slot0,
    minimumNoticeMs: 0,
    validFrom: slot0,
    validThrough,
    assessments: [
      {
        startTime: slot0,
        finishTime: slot1,
        evaluation: 'evaluated',
        safety: 'eligible',
        conditionsFit: 0.7,
        reasons: [],
      },
      {
        startTime: slot1,
        finishTime: slot2,
        evaluation: 'evaluated',
        safety: 'eligible',
        conditionsFit: 0.709,
        reasons: [],
      },
    ],
    expected: { status: 'recommended', winnerStart: slot0 },
  },
} as const satisfies Record<string, RecommendationScenarioFixture>;

export const actionabilityFixture = {
  windowStart: slot0,
  windowEnd: slot2,
  decisionTime: slot0 + 3 * EVALUATION_MINUTE_MS,
  minimumNoticeMs: 27 * EVALUATION_MINUTE_MS,
  expectedGridStarts: [slot2],
} as const;

export const finishValidityFixture = {
  windowStart: slot0,
  windowEnd: slot2,
  startWindowPolicy: 'start-within',
  runDurationMs: EVALUATION_GRID_MS + 1,
  forecastValidThrough: slot2 + EVALUATION_GRID_MS,
  expected: [
    { startTime: slot0, finishWithinValidity: true },
    { startTime: slot1, finishWithinValidity: true },
    { startTime: slot2, finishWithinValidity: false },
  ],
} as const;

export const dstOccurrenceFixtures = {
  springForwardGap: {
    timezone: 'America/Chicago',
    localDate: '2026-03-08',
    localTime: '02:30',
    expectedInstants: [],
    reason: 'NONEXISTENT_LOCAL_TIME',
  },
  fallBackFold: {
    timezone: 'America/Chicago',
    localDate: '2026-11-01',
    localTime: '01:30',
    expectedInstants: [
      Date.parse('2026-11-01T06:30:00.000Z'),
      Date.parse('2026-11-01T07:30:00.000Z'),
    ],
    reason: 'AMBIGUOUS_LOCAL_TIME',
  },
} as const;

export interface TimedConditionsSampleFixture {
  elapsedMs: number;
  value: number;
}

export const timeWeightingFixtures = {
  coarse: [
    { elapsedMs: 0, value: 10 },
    { elapsedMs: 10 * EVALUATION_MINUTE_MS, value: 20 },
    { elapsedMs: 30 * EVALUATION_MINUTE_MS, value: 30 },
  ],
  linearlyResampled: [
    { elapsedMs: 0, value: 10 },
    { elapsedMs: 5 * EVALUATION_MINUTE_MS, value: 15 },
    { elapsedMs: 10 * EVALUATION_MINUTE_MS, value: 20 },
    { elapsedMs: 20 * EVALUATION_MINUTE_MS, value: 25 },
    { elapsedMs: 30 * EVALUATION_MINUTE_MS, value: 30 },
  ],
  expectedTrapezoidalMean: 65 / 3,
} as const satisfies {
  coarse: readonly TimedConditionsSampleFixture[];
  linearlyResampled: readonly TimedConditionsSampleFixture[];
  expectedTrapezoidalMean: number;
};
