import {
  contentIdentity,
  fetchNormalizedRouteForecast,
  normalizeOpenMeteoForecast,
  type FetchedRouteForecast,
  type PlanningRoute,
  type RawOpenMeteoLocation,
} from '@runcast/core';

export const E2E_ROUTE_ID = '8cbd2d47-16b3-4f35-910f-2b99c54d5636';
export const E2E_ROUTE_NAME = 'Maestro Lake Loop';
export const E2E_GPX_FILENAME = 'maestro-lake-loop.gpx';
export const E2E_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Runcast Maestro" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${E2E_ROUTE_NAME}</name>
    <trkseg>
      <trkpt lat="41.894500" lon="-87.619500"><ele>181</ele></trkpt>
      <trkpt lat="41.897000" lon="-87.616000"><ele>184</ele></trkpt>
      <trkpt lat="41.893500" lon="-87.612500"><ele>186</ele></trkpt>
      <trkpt lat="41.890500" lon="-87.616500"><ele>182</ele></trkpt>
      <trkpt lat="41.894500" lon="-87.619500"><ele>181</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

export function e2eBuildEnabled(input: {
  appEnvironment: string | undefined;
  mode: string | undefined;
}): boolean {
  return input.appEnvironment === 'e2e' && input.mode === 'enabled';
}

export function deterministicForecastEnabled(input: {
  e2eBuild: boolean;
  providerBaseUrl: string | undefined;
}): boolean {
  return input.e2eBuild && !input.providerBaseUrl?.trim();
}

/**
 * Expo replaces both direct environment reads at bundle time. Production builds do not set
 * either value and app.config rejects the E2E mode unless it also switches to the isolated E2E
 * application identifier.
 */
export const E2E_BUILD_ENABLED = e2eBuildEnabled({
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
  mode: process.env.EXPO_PUBLIC_E2E_MODE,
});

export function e2eRouteIdForImport(
  xml: string,
  filename: string,
  enabled = E2E_BUILD_ENABLED,
): string | null {
  return enabled && xml === E2E_GPX && filename === E2E_GPX_FILENAME ? E2E_ROUTE_ID : null;
}

export type RouteForecastFetcher = (
  route: PlanningRoute,
  signal?: AbortSignal,
) => Promise<FetchedRouteForecast>;

function filled(length: number, value: number): number[] {
  return Array.from({ length }, () => value);
}

function deterministicForecast(route: PlanningRoute, now: number): FetchedRouteForecast {
  const hourMs = 60 * 60 * 1000;
  const firstHour = Math.floor(now / hourMs) * hourMs - 6 * hourMs;
  const time = Array.from({ length: 79 }, (_, index) => firstHour + index * hourMs);
  const requested = [
    { ...route.part.points[0], routeDistanceM: 0 },
    { ...route.part.points.at(-1)!, routeDistanceM: route.totalDistanceM },
  ].map(({ lat, lon, routeDistanceM }) => ({ lat, lon, routeDistanceM }));
  const payloads: RawOpenMeteoLocation[] = requested.map(({ lat, lon }) => ({
    latitude: lat,
    longitude: lon,
    timezone: 'America/Chicago',
    utc_offset_seconds: -5 * 60 * 60,
    hourly_units: {
      time: 'unixtime',
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
      time,
      temperature_2m: filled(time.length, 19),
      apparent_temperature: filled(time.length, 18),
      relative_humidity_2m: filled(time.length, 58),
      wind_speed_10m: filled(time.length, 3),
      wind_direction_10m: filled(time.length, 210),
      wind_gusts_10m: filled(time.length, 5),
      cloud_cover: filled(time.length, 25),
      precipitation_probability: filled(time.length, 10),
      precipitation: filled(time.length, 0),
      weather_code: filled(time.length, 1),
      shortwave_radiation: filled(time.length, 260),
      direct_normal_irradiance: filled(time.length, 180),
      diffuse_radiation: filled(time.length, 80),
    },
  }));
  const fetchId = contentIdentity({ source: 'runcast-e2e', routeId: route.id, fetchedAt: now });
  return {
    field: normalizeOpenMeteoForecast(payloads, requested, { fetchId, fetchedAt: now }),
    timezone: 'America/Chicago',
  };
}

/**
 * An isolated E2E build uses fixture weather unless a provider URL is explicitly supplied for a
 * simulator review. Its one fixture route fails exactly once per fixture-backed process so the
 * real error and retry UI can be exercised deterministically.
 */
export function createRouteForecastFetcher(
  enabled: boolean,
  options: {
    liveFetcher?: RouteForecastFetcher;
    now?: () => number;
  } = {},
): RouteForecastFetcher {
  const providerBaseUrl = process.env.EXPO_PUBLIC_OPEN_METEO_BASE_URL?.trim() || undefined;
  const liveFetcher =
    options.liveFetcher ??
    ((route: PlanningRoute, signal?: AbortSignal) =>
      fetchNormalizedRouteForecast(route, signal, providerBaseUrl));
  const now = options.now ?? Date.now;
  const failedFixtureRoutes = new Set<string>();

  return async (route, signal) => {
    if (!enabled) return liveFetcher(route, signal);
    if (signal?.aborted) throw new Error('E2E forecast request aborted.');
    if (route.id === E2E_ROUTE_ID && !failedFixtureRoutes.has(route.id)) {
      failedFixtureRoutes.add(route.id);
      throw new Error('E2E forecast provider unavailable.');
    }
    return deterministicForecast(route, now());
  };
}

export const E2E_FORECAST_FIXTURE_ENABLED = deterministicForecastEnabled({
  e2eBuild: E2E_BUILD_ENABLED,
  providerBaseUrl: process.env.EXPO_PUBLIC_OPEN_METEO_BASE_URL,
});

export const fetchRouteForecast = createRouteForecastFetcher(E2E_FORECAST_FIXTURE_ENABLED);
