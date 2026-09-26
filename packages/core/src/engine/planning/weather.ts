import { normalizeBearing, toDeg, toRad } from '../geo';
import { contentIdentity } from './identity';
import type {
  NormalizedRouteForecast,
  NormalizedForecastSeries,
  ForecastVariableMetadata,
  ForecastVariable,
} from './types';
import { NORMALIZED_ROUTE_FORECAST_MODEL_VERSION } from './versions';

export const OPEN_METEO_FORECAST_VARIABLES = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'cloud_cover',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'shortwave_radiation',
  'direct_normal_irradiance',
  'diffuse_radiation',
] as const;

type ProviderVariable = (typeof OPEN_METEO_FORECAST_VARIABLES)[number];
type ProviderValue = number | null;

export interface RawOpenMeteoLocation {
  latitude: number;
  longitude: number;
  timezone: string;
  utc_offset_seconds: number;
  hourly_units: Record<ProviderVariable | 'time', string>;
  hourly: Record<ProviderVariable, ProviderValue[]> & { time: Array<string | number> };
}

export interface RequestedForecastAnchor {
  lat: number;
  lon: number;
  routeDistanceM: number;
}

export interface ForecastNormalizationMetadata {
  fetchId: string;
  fetchedAt: number;
  providerModel?: string | null;
  providerRun?: string | null;
}

export type ForecastNormalizationErrorCode =
  | 'ARRAY_LENGTH_MISMATCH'
  | 'DUPLICATE_TIME'
  | 'INVALID_LOCATION_COUNT'
  | 'INVALID_RANGE'
  | 'INVALID_TIME'
  | 'INVALID_UNIT'
  | 'UNSORTED_TIME';

export class ForecastNormalizationError extends Error {
  constructor(
    public readonly code: ForecastNormalizationErrorCode,
    message: string,
    public readonly variable?: string,
  ) {
    super(message);
    this.name = 'ForecastNormalizationError';
  }
}

interface VariableDefinition {
  provider: ProviderVariable;
  normalized: ForecastVariable;
  unit: string;
  metadata: ForecastVariableMetadata;
}

const VARIABLE_DEFINITIONS: readonly VariableDefinition[] = [
  ['temperature_2m', 'temperatureC', '°C', 'instant', -90, 65, true],
  ['apparent_temperature', 'feelsLikeC', '°C', 'instant', -100, 80, false],
  ['relative_humidity_2m', 'humidityPct', '%', 'instant', 0, 100, false],
  ['wind_speed_10m', 'windSpeedMs', 'm/s', 'instant', 0, 100, true],
  ['wind_direction_10m', 'windDirectionFromDeg', '°', 'instant', 0, 360, true],
  ['wind_gusts_10m', 'gustMs', 'm/s', 'interval-max', 0, 150, true],
  ['cloud_cover', 'cloudCoverPct', '%', 'instant', 0, 100, false],
  ['precipitation_probability', 'precipitationProbabilityPct', '%', 'probability', 0, 100, true],
  ['precipitation', 'precipitationMm', 'mm', 'interval-sum', 0, 500, true],
  ['weather_code', 'weatherCode', 'wmo code', 'categorical', 0, 99, true],
  ['shortwave_radiation', 'shortwaveRadiationWm2', 'W/m²', 'interval-mean', 0, 2000, true],
  ['direct_normal_irradiance', 'directNormalRadiationWm2', 'W/m²', 'interval-mean', 0, 2000, true],
  ['diffuse_radiation', 'diffuseRadiationWm2', 'W/m²', 'interval-mean', 0, 2000, true],
].map(([provider, normalized, unit, semantics, minimum, maximum, required]) => ({
  provider: provider as ProviderVariable,
  normalized: normalized as ForecastVariable,
  unit: unit as string,
  metadata: {
    semantics: semantics as ForecastVariableMetadata['semantics'],
    unit: unit as string,
    validRange: [minimum as number, maximum as number],
    required: required as boolean,
  },
}));

const VARIABLE_METADATA = Object.fromEntries(
  VARIABLE_DEFINITIONS.map((definition) => [definition.normalized, definition.metadata]),
) as Record<ForecastVariable, ForecastVariableMetadata>;

function fail(code: ForecastNormalizationErrorCode, message: string, variable?: string): never {
  throw new ForecastNormalizationError(code, message, variable);
}

function parseTimes(values: Array<string | number>): number[] {
  const times = values.map((value) =>
    typeof value === 'number' ? (value < 10_000_000_000 ? value * 1000 : value) : Date.parse(value),
  );
  if (times.some((time) => !Number.isFinite(time))) {
    return fail('INVALID_TIME', 'Weather contains an invalid timestamp.', 'time');
  }
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] === times[index - 1]) {
      return fail('DUPLICATE_TIME', 'Weather timestamps must be unique.', 'time');
    }
    if (times[index] < times[index - 1]) {
      return fail('UNSORTED_TIME', 'Weather timestamps must strictly increase.', 'time');
    }
  }
  return times;
}

export function normalizeOpenMeteoForecast(
  payloads: readonly RawOpenMeteoLocation[],
  requested: readonly RequestedForecastAnchor[],
  metadata: ForecastNormalizationMetadata,
): NormalizedRouteForecast {
  if (payloads.length === 0 || payloads.length !== requested.length) {
    return fail('INVALID_LOCATION_COUNT', 'Returned weather locations must match the request.');
  }
  const missingCounts = Object.fromEntries(
    VARIABLE_DEFINITIONS.map((definition) => [definition.normalized, 0]),
  ) as Record<ForecastVariable, number>;
  let commonFirst = -Infinity;
  let commonLast = Infinity;

  const anchors = payloads.map((payload, anchorIndex) => {
    if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
      return fail('INVALID_RANGE', 'Provider returned invalid coordinates.', 'coordinates');
    }
    const times = parseTimes(payload.hourly.time);
    if (times.length < 2) {
      return fail('ARRAY_LENGTH_MISMATCH', 'Weather requires at least two timestamps.', 'time');
    }
    commonFirst = Math.max(commonFirst, times[0]);
    commonLast = Math.min(commonLast, times.at(-1)!);
    const values = {} as Record<ForecastVariable, Array<number | null>>;
    for (const definition of VARIABLE_DEFINITIONS) {
      if (payload.hourly_units[definition.provider] !== definition.unit) {
        return fail(
          'INVALID_UNIT',
          `${definition.provider} must use ${definition.unit}.`,
          definition.provider,
        );
      }
      const source = payload.hourly[definition.provider];
      if (!Array.isArray(source) || source.length !== times.length) {
        return fail(
          'ARRAY_LENGTH_MISMATCH',
          `${definition.provider} must align with time.`,
          definition.provider,
        );
      }
      const [minimum, maximum] = definition.metadata.validRange;
      values[definition.normalized] = source.map((value) => {
        if (value === null) {
          missingCounts[definition.normalized] += 1;
          return null;
        }
        if (!Number.isFinite(value) || value < minimum || value > maximum) {
          return fail(
            'INVALID_RANGE',
            `${definition.provider} is outside its valid range.`,
            definition.provider,
          );
        }
        return value;
      });
    }
    const hourly: NormalizedForecastSeries = { time: times, values };
    return {
      routeDistanceM: requested[anchorIndex].routeDistanceM,
      lat: payload.latitude,
      lon: payload.longitude,
      hourly,
    };
  });

  if (!(commonLast >= commonFirst)) {
    return fail('INVALID_TIME', 'Weather locations have no common validity interval.', 'time');
  }
  const withoutHash = {
    schemaVersion: 2 as const,
    normalizationVersion: NORMALIZED_ROUTE_FORECAST_MODEL_VERSION,
    provider: 'open-meteo',
    providerModel: metadata.providerModel ?? null,
    providerRun: metadata.providerRun ?? null,
    fetchId: metadata.fetchId,
    fetchedAt: metadata.fetchedAt,
    validFrom: commonFirst,
    validUntil: commonLast,
    requestedCoordinates: requested.map(({ lat, lon }) => ({ lat, lon })),
    returnedCoordinates: anchors.map(({ lat, lon }) => ({ lat, lon })),
    variables: VARIABLE_METADATA,
    anchors,
    missingCounts,
    reasons: [] as string[],
  };
  return { ...withoutHash, contentHash: contentIdentity(withoutHash) };
}

export interface ForecastSample {
  values: Record<ForecastVariable, number | null>;
  support: { validFrom: number; validUntil: number };
}

export type ForecastSampleResult =
  { status: 'ok'; sample: ForecastSample } | { status: 'unevaluable'; reasons: string[] };

function intervalIndex(times: number[], at: number): number {
  if (at < times[0] || at > times.at(-1)!) return -1;
  if (at === times.at(-1)) return times.length - 1;
  let lower = 0;
  let upper = times.length - 2;
  while (lower < upper) {
    const middle = (lower + upper + 1) >> 1;
    if (times[middle] <= at) lower = middle;
    else upper = middle - 1;
  }
  return lower;
}

function sampleAnchor(
  series: NormalizedForecastSeries,
  at: number,
): Record<ForecastVariable, number | null> | null {
  const index = intervalIndex(series.time, at);
  if (index < 0) return null;
  const next = Math.min(index + 1, series.time.length - 1);
  const fraction =
    next === index ? 0 : (at - series.time[index]) / (series.time[next] - series.time[index]);
  const result = {} as Record<ForecastVariable, number | null>;
  for (const definition of VARIABLE_DEFINITIONS) {
    const values = series.values[definition.normalized];
    if (definition.metadata.semantics === 'instant') {
      const left = values[index];
      const right = values[next];
      result[definition.normalized] =
        left === null || right === null ? null : left + (right - left) * fraction;
    } else {
      result[definition.normalized] = values[index];
    }
  }
  const speedA = series.values.windSpeedMs[index];
  const directionA = series.values.windDirectionFromDeg[index];
  const speedB = series.values.windSpeedMs[next];
  const directionB = series.values.windDirectionFromDeg[next];
  if (speedA !== null && directionA !== null && speedB !== null && directionB !== null) {
    const vector = (speed: number, directionFrom: number) => ({
      east: Math.sin(toRad(directionFrom + 180)) * speed,
      north: Math.cos(toRad(directionFrom + 180)) * speed,
    });
    const a = vector(speedA, directionA);
    const b = vector(speedB, directionB);
    const east = a.east + (b.east - a.east) * fraction;
    const north = a.north + (b.north - a.north) * fraction;
    result.windSpeedMs = Math.hypot(east, north);
    result.windDirectionFromDeg =
      result.windSpeedMs < 1e-9 ? 0 : normalizeBearing(toDeg(Math.atan2(east, north)) + 180);
  }
  return result;
}

export function sampleRouteForecast(
  field: NormalizedRouteForecast,
  routeDistanceM: number,
  at: number,
): ForecastSampleResult {
  if (at < field.validFrom || at > field.validUntil) {
    return { status: 'unevaluable', reasons: ['weather.outside-validity'] };
  }
  const anchors = field.anchors;
  let lower = anchors[0];
  let upper = anchors.at(-1)!;
  let fraction = 0;
  if (routeDistanceM <= lower.routeDistanceM || anchors.length === 1) upper = lower;
  else if (routeDistanceM >= upper.routeDistanceM) lower = upper;
  else {
    for (let index = 0; index < anchors.length - 1; index += 1) {
      if (anchors[index + 1].routeDistanceM >= routeDistanceM) {
        lower = anchors[index];
        upper = anchors[index + 1];
        fraction =
          (routeDistanceM - lower.routeDistanceM) / (upper.routeDistanceM - lower.routeDistanceM);
        break;
      }
    }
  }
  const a = sampleAnchor(lower.hourly, at);
  const b = lower === upper ? a : sampleAnchor(upper.hourly, at);
  if (!a || !b) return { status: 'unevaluable', reasons: ['weather.outside-validity'] };
  const values = {} as Record<ForecastVariable, number | null>;
  for (const definition of VARIABLE_DEFINITIONS) {
    const left = a[definition.normalized];
    const right = b[definition.normalized];
    values[definition.normalized] =
      left === null || right === null
        ? null
        : definition.metadata.semantics === 'categorical'
          ? fraction < 0.5
            ? left
            : right
          : left + (right - left) * fraction;
  }
  const missingRequired = VARIABLE_DEFINITIONS.filter(
    (definition) => definition.metadata.required && values[definition.normalized] === null,
  );
  if (missingRequired.length) {
    return {
      status: 'unevaluable',
      reasons: missingRequired.map(
        (definition) => `weather.missing-critical-field:${definition.normalized}`,
      ),
    };
  }
  return {
    status: 'ok',
    sample: {
      values,
      support: { validFrom: field.validFrom, validUntil: field.validUntil },
    },
  };
}
