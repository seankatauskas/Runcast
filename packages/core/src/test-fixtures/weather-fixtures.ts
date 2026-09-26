/** Test-only Open-Meteo-like payloads for pure normalizer and sampler tests. */

export const WEATHER_FIXTURE_HOUR_MS = 3_600_000;
export const WEATHER_FIXTURE_T0 = Date.UTC(2026, 6, 18, 12, 0, 0);

export type WeatherValue = number | null;

export interface WeatherFixtureUnits {
  time: 'iso8601' | string;
  temperature_2m: '°C' | string;
  apparent_temperature: '°C' | string;
  relative_humidity_2m: '%' | string;
  wind_speed_10m: 'm/s' | string;
  wind_direction_10m: '°' | string;
  wind_gusts_10m: 'm/s' | string;
  cloud_cover: '%' | string;
  precipitation_probability: '%' | string;
  precipitation: 'mm' | string;
  weather_code: 'wmo code' | string;
  shortwave_radiation: 'W/m²' | string;
  direct_normal_irradiance: 'W/m²' | string;
  diffuse_radiation: 'W/m²' | string;
}

export interface WeatherFixtureHourly {
  time: string[];
  temperature_2m: WeatherValue[];
  apparent_temperature: WeatherValue[];
  relative_humidity_2m: WeatherValue[];
  wind_speed_10m: WeatherValue[];
  wind_direction_10m: WeatherValue[];
  wind_gusts_10m: WeatherValue[];
  cloud_cover: WeatherValue[];
  precipitation_probability: WeatherValue[];
  precipitation: WeatherValue[];
  weather_code: WeatherValue[];
  shortwave_radiation: WeatherValue[];
  direct_normal_irradiance: WeatherValue[];
  diffuse_radiation: WeatherValue[];
}

export interface WeatherProviderPayloadFixture {
  requested: { latitude: number; longitude: number };
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  utc_offset_seconds: number;
  generationtime_ms: number;
  hourly_units: WeatherFixtureUnits;
  hourly: WeatherFixtureHourly;
}

export interface WeatherNormalizationFixture {
  description: string;
  payload: WeatherProviderPayloadFixture;
  expected:
    | { outcome: 'accepted'; missingCount?: Partial<Record<keyof WeatherFixtureHourly, number>> }
    | {
        outcome: 'rejected';
        reason:
          | 'ARRAY_LENGTH_MISMATCH'
          | 'DUPLICATE_TIME'
          | 'INVALID_RANGE'
          | 'INVALID_UNIT'
          | 'UNSORTED_TIME';
      };
}

export const expectedTemporalSemantics = {
  temperature_2m: 'instant',
  apparent_temperature: 'instant',
  relative_humidity_2m: 'instant',
  wind_speed_10m: 'instant-vector',
  wind_direction_10m: 'instant-vector',
  wind_gusts_10m: 'preceding-interval-max',
  cloud_cover: 'instant',
  precipitation_probability: 'preceding-interval-probability',
  precipitation: 'preceding-interval-sum',
  weather_code: 'categorical-hold',
  shortwave_radiation: 'preceding-interval-mean',
  direct_normal_irradiance: 'preceding-interval-mean',
  diffuse_radiation: 'preceding-interval-mean',
} as const;

const validTimes = Array.from({ length: 4 }, (_, index) =>
  new Date(WEATHER_FIXTURE_T0 + index * WEATHER_FIXTURE_HOUR_MS).toISOString(),
);

function cloneArray(values: readonly WeatherValue[]): WeatherValue[] {
  return [...values];
}

export function makeValidWeatherPayload(): WeatherProviderPayloadFixture {
  return {
    requested: { latitude: 41.9, longitude: -87.6 },
    latitude: 41.875,
    longitude: -87.625,
    elevation: 181,
    timezone: 'GMT',
    utc_offset_seconds: 0,
    generationtime_ms: 0.42,
    hourly_units: {
      time: 'iso8601',
      temperature_2m: '°C',
      apparent_temperature: '°C',
      relative_humidity_2m: '%',
      wind_speed_10m: 'm/s',
      wind_direction_10m: '°',
      wind_gusts_10m: 'm/s',
      cloud_cover: '%',
      precipitation_probability: '%',
      precipitation: 'mm',
      weather_code: 'wmo code',
      shortwave_radiation: 'W/m²',
      direct_normal_irradiance: 'W/m²',
      diffuse_radiation: 'W/m²',
    },
    hourly: {
      time: [...validTimes],
      temperature_2m: cloneArray([20, 21, 22, 23]),
      apparent_temperature: cloneArray([20, 21, 22, 23]),
      relative_humidity_2m: cloneArray([60, 58, 56, 54]),
      wind_speed_10m: cloneArray([2, 3, 4, 5]),
      wind_direction_10m: cloneArray([350, 10, 90, 180]),
      wind_gusts_10m: cloneArray([4, 6, 8, 10]),
      cloud_cover: cloneArray([10, 20, 30, 40]),
      precipitation_probability: cloneArray([null, 20, 80, 0]),
      precipitation: cloneArray([0, 2, 0, 1]),
      weather_code: cloneArray([1, 61, 95, 2]),
      shortwave_radiation: cloneArray([100, 300, 500, 200]),
      direct_normal_irradiance: cloneArray([50, 220, 420, 100]),
      diffuse_radiation: cloneArray([70, 120, 150, 110]),
    },
  };
}

function fixture(
  description: string,
  mutate: (payload: WeatherProviderPayloadFixture) => void,
  expected: WeatherNormalizationFixture['expected'],
): WeatherNormalizationFixture {
  const payload = makeValidWeatherPayload();
  mutate(payload);
  return { description, payload, expected };
}

export const weatherNormalizationFixtures = {
  validWithProviderNull: fixture(
    'provider null is preserved and counted rather than converted to zero',
    () => undefined,
    { outcome: 'accepted', missingCount: { precipitation_probability: 1 } },
  ),
  mismatchedArray: fixture(
    'every required variable array must align exactly with time',
    (payload) => {
      payload.hourly.wind_gusts_10m.pop();
    },
    { outcome: 'rejected', reason: 'ARRAY_LENGTH_MISMATCH' },
  ),
  unsortedTime: fixture(
    'timestamps must increase rather than being reordered silently',
    (payload) => {
      [payload.hourly.time[1], payload.hourly.time[2]] = [
        payload.hourly.time[2],
        payload.hourly.time[1],
      ];
    },
    { outcome: 'rejected', reason: 'UNSORTED_TIME' },
  ),
  duplicateTime: fixture(
    'duplicate instants do not define an interpolation interval',
    (payload) => {
      payload.hourly.time[2] = payload.hourly.time[1];
    },
    { outcome: 'rejected', reason: 'DUPLICATE_TIME' },
  ),
  invalidTemperatureUnit: fixture(
    'normalization requires requested metric units',
    (payload) => {
      payload.hourly_units.temperature_2m = '°F';
    },
    { outcome: 'rejected', reason: 'INVALID_UNIT' },
  ),
  invalidWindUnit: fixture(
    'wind cannot be interpreted as m/s when the provider returned km/h',
    (payload) => {
      payload.hourly_units.wind_speed_10m = 'km/h';
    },
    { outcome: 'rejected', reason: 'INVALID_UNIT' },
  ),
  probabilityOutOfRange: fixture(
    'probabilities outside [0, 100] are invalid',
    (payload) => {
      payload.hourly.precipitation_probability[2] = 101;
    },
    { outcome: 'rejected', reason: 'INVALID_RANGE' },
  ),
  negativePrecipitation: fixture(
    'interval precipitation totals cannot be negative',
    (payload) => {
      payload.hourly.precipitation[1] = -0.1;
    },
    { outcome: 'rejected', reason: 'INVALID_RANGE' },
  ),
  negativeRadiation: fixture(
    'normalized radiation is nonnegative',
    (payload) => {
      payload.hourly.diffuse_radiation[1] = -1;
    },
    { outcome: 'rejected', reason: 'INVALID_RANGE' },
  ),
  impossibleHumidity: fixture(
    'relative humidity outside [0, 100] is invalid',
    (payload) => {
      payload.hourly.relative_humidity_2m[0] = 120;
    },
    { outcome: 'rejected', reason: 'INVALID_RANGE' },
  ),
} as const satisfies Record<string, WeatherNormalizationFixture>;

export interface IntervalSamplingFixture {
  source: Array<{ validFrom: number; validThrough: number; value: number | null }>;
  queries: Array<{
    at: number;
    expectedAmount?: number;
    expectedValue?: number | null;
    expectedAvailability: 'available' | 'unavailable';
  }>;
}

export const precipitationIntervalFixture: IntervalSamplingFixture = {
  source: [
    {
      validFrom: WEATHER_FIXTURE_T0,
      validThrough: WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS,
      value: 2,
    },
    {
      validFrom: WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS,
      validThrough: WEATHER_FIXTURE_T0 + 2 * WEATHER_FIXTURE_HOUR_MS,
      value: 0,
    },
  ],
  queries: [
    {
      at: WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS / 2,
      expectedAmount: 1,
      expectedAvailability: 'available',
    },
    {
      at: WEATHER_FIXTURE_T0 + 3 * WEATHER_FIXTURE_HOUR_MS,
      expectedAvailability: 'unavailable',
    },
  ],
};

export const probabilityHoldFixture: IntervalSamplingFixture = {
  source: [
    {
      validFrom: WEATHER_FIXTURE_T0,
      validThrough: WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS,
      value: null,
    },
    {
      validFrom: WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS,
      validThrough: WEATHER_FIXTURE_T0 + 2 * WEATHER_FIXTURE_HOUR_MS,
      value: 80,
    },
  ],
  queries: [
    {
      at: WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS / 2,
      expectedValue: null,
      expectedAvailability: 'available',
    },
    {
      at: WEATHER_FIXTURE_T0 + 1.5 * WEATHER_FIXTURE_HOUR_MS,
      expectedValue: 80,
      expectedAvailability: 'available',
    },
  ],
};

export const forecastValidityFixtures = {
  exactBoundary: {
    validFrom: WEATHER_FIXTURE_T0,
    validThrough: WEATHER_FIXTURE_T0 + 4 * WEATHER_FIXTURE_HOUR_MS,
    runStart: WEATHER_FIXTURE_T0 + 3 * WEATHER_FIXTURE_HOUR_MS,
    runFinish: WEATHER_FIXTURE_T0 + 4 * WEATHER_FIXTURE_HOUR_MS,
    expected: 'evaluable',
  },
  finishAfterValidity: {
    validFrom: WEATHER_FIXTURE_T0,
    validThrough: WEATHER_FIXTURE_T0 + 4 * WEATHER_FIXTURE_HOUR_MS,
    runStart: WEATHER_FIXTURE_T0 + 3.5 * WEATHER_FIXTURE_HOUR_MS,
    runFinish: WEATHER_FIXTURE_T0 + 4.5 * WEATHER_FIXTURE_HOUR_MS,
    expected: 'unevaluable',
  },
  beforeValidity: {
    validFrom: WEATHER_FIXTURE_T0,
    validThrough: WEATHER_FIXTURE_T0 + 4 * WEATHER_FIXTURE_HOUR_MS,
    runStart: WEATHER_FIXTURE_T0 - 1,
    runFinish: WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS,
    expected: 'unevaluable',
  },
} as const;

export const forecastFreshnessFixtures = {
  ready: {
    fetchedAt: WEATHER_FIXTURE_T0,
    decisionTime: WEATHER_FIXTURE_T0 + 5 * 60_000,
    validThrough: WEATHER_FIXTURE_T0 + 4 * WEATHER_FIXTURE_HOUR_MS,
    expected: 'ready',
  },
  staleWithinValidity: {
    fetchedAt: WEATHER_FIXTURE_T0,
    decisionTime: WEATHER_FIXTURE_T0 + 45 * 60_000,
    validThrough: WEATHER_FIXTURE_T0 + 4 * WEATHER_FIXTURE_HOUR_MS,
    expected: 'stale-within-validity',
  },
  expired: {
    fetchedAt: WEATHER_FIXTURE_T0,
    decisionTime: WEATHER_FIXTURE_T0 + 5 * WEATHER_FIXTURE_HOUR_MS,
    validThrough: WEATHER_FIXTURE_T0 + 4 * WEATHER_FIXTURE_HOUR_MS,
    expected: 'expired',
  },
} as const;
