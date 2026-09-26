/**
 * Test-only V1 inputs retained for compatibility/replay tests.
 *
 * In particular, numeric zero elevation in these artifacts is ambiguous: it may
 * be real sea level or the V1 parser's missing-elevation fallback. V2 adapters
 * must label the route degraded and use flat timing rather than reinterpret it.
 */

export const LEGACY_REPLAY_T0 = Date.UTC(2026, 6, 18, 12, 0, 0);
const hour = 3_600_000;

export const legacyV1RouteSnapshot = {
  id: 'legacy-route-001',
  name: 'Legacy lakeshore route',
  points: [
    { lat: 41.9, lon: -87.6, ele: 180 },
    { lat: 41.901, lon: -87.6, ele: 0 },
    { lat: 41.902, lon: -87.6, ele: 181 },
  ],
  cumulative: [0, 111.2, 222.4],
  totalDistance: 222.4,
} as const;

const legacyHours = Array.from({ length: 5 }, (_, index) => LEGACY_REPLAY_T0 + index * hour);

export const legacyV1WeatherFieldSnapshot = {
  anchors: [
    {
      routeDistance: 0,
      lat: 41.9,
      lon: -87.6,
      hourly: {
        time: legacyHours,
        temp: [20, 21, 22, 23, 24],
        feelsLike: [20, 21, 23, 25, 26],
        humidity: [60, 58, 55, 52, 50],
        windSpeed: [2, 3, 4, 5, 4],
        windDirFrom: [350, 10, 45, 90, 180],
        gust: [4, 6, 8, 10, 9],
        cloudCover: [20, 30, 40, 50, 60],
        precipProb: [0, 0, 40, 80, 20],
        precip: [0, 0, 1, 3, 0],
        weatherCode: [1, 2, 61, 65, 2],
      },
    },
  ],
  fetchedAt: LEGACY_REPLAY_T0,
} as const;

export const legacyV1CoverageSnapshot = {
  resolution: 50,
  values: ['unknown', 'tree', 'open', 'open', 'unknown'],
} as const;

export const legacyV1PlanInput = {
  routeId: legacyV1RouteSnapshot.id,
  startTime: LEGACY_REPLAY_T0 + hour,
  speed: 3,
} as const;

export const legacyV1RecommendationInput = {
  input: { routeId: legacyV1RouteSnapshot.id, speed: 3 },
  windowStart: LEGACY_REPLAY_T0,
  windowEnd: LEGACY_REPLAY_T0 + 4 * hour,
} as const;

export const legacyV1StoredRecommendation = {
  id: '018f9f9a-7b5e-7000-8000-000000000001',
  watchId: '018f9f9a-7b5e-7000-8000-000000000002',
  occurrenceDate: '2026-07-18',
  bestStart: new Date(LEGACY_REPLAY_T0 + hour).toISOString(),
  summary: {
    duration: 74.13333333333334,
    feelsLike: { min: 21, max: 21.05 },
    shadeFraction: 0.5,
    headwindDistance: 0,
    comfort: 0.91,
    penalties: { temp: 0.08, sun: 0, headwind: 0.01, rain: 0 },
    maxPrecipProb: 0,
    alerts: [],
  },
  engineVersion: 'runcast-engine-v1',
} as const;

export const legacyReplayFixture = {
  route: legacyV1RouteSnapshot,
  weather: legacyV1WeatherFieldSnapshot,
  coverage: legacyV1CoverageSnapshot,
  planInput: legacyV1PlanInput,
  recommendationInput: legacyV1RecommendationInput,
  storedRecommendation: legacyV1StoredRecommendation,
  expectedV2Adaptation: {
    elevationStatus: 'legacy-unknown',
    timingModel: 'flat-v1',
    reasons: ['LEGACY_ELEVATION_AMBIGUOUS', 'FLAT_TIMING_FALLBACK'],
  },
} as const;
