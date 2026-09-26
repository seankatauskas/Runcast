/**
 * Open-Meteo client — the only place weather leaves the network.
 *
 * Strategy: pick evenly spaced anchor points along the route (~one per
 * 2.5 km, between 2 and 8) and fetch all of them in a single request
 * (Open-Meteo accepts comma-separated coordinate lists). We always fetch
 * 3 full days of hourly data so the start-time slider and the best-start
 * search re-interpolate from cache and never refetch while dragging.
 */
import { segmentIndexAt } from '../engine/interpolate';
import { contentIdentity } from '../engine/planning/identity';
import {
  normalizeOpenMeteoForecast,
  OPEN_METEO_FORECAST_VARIABLES,
  type RawOpenMeteoLocation,
  type RequestedForecastAnchor,
} from '../engine/planning/weather';
import type { NormalizedRouteForecast, PlanningRoute } from '../engine/planning/types';
import { fetchWithDeadline } from './deadline';

const BASE = 'https://api.open-meteo.com/v1/forecast';
const ANCHOR_SPACING = 2500; // meters
const MIN_ANCHORS = 2;
const MAX_ANCHORS = 8;
const PROVIDER_ATTEMPTS_PER_MODEL = 2;
const PROVIDER_RETRY_DELAY_MS = 350;
const PROVIDER_MODEL_FALLBACK = 'ecmwf_ifs025';
const PROVIDER_FALLBACK_CHUNK_SIZE = 2;

class OpenMeteoHttpError extends Error {
  constructor(readonly status: number) {
    super(`Open-Meteo returned ${status}`);
    this.name = 'OpenMeteoHttpError';
  }
}

export interface FetchedRouteForecast {
  field: NormalizedRouteForecast;
  timezone: string;
}

function forecastAnchorDistances(totalDistanceM: number): number[] {
  const n = Math.min(
    Math.max(Math.round(totalDistanceM / ANCHOR_SPACING) + 1, MIN_ANCHORS),
    MAX_ANCHORS,
  );
  return Array.from({ length: n }, (_, i) => (totalDistanceM * i) / (n - 1));
}

export function planningForecastAnchorDistances(route: PlanningRoute): number[] {
  return forecastAnchorDistances(route.totalDistanceM);
}

function planningRoutePointAt(route: PlanningRoute, routeDistanceM: number) {
  const index = segmentIndexAt(route.cumulativeDistanceM, routeDistanceM);
  const startDistanceM = route.cumulativeDistanceM[index];
  const endDistanceM = route.cumulativeDistanceM[index + 1];
  const fraction =
    endDistanceM > startDistanceM
      ? (routeDistanceM - startDistanceM) / (endDistanceM - startDistanceM)
      : 0;
  const start = route.part.points[index];
  const end = route.part.points[index + 1];
  return {
    lat: start.lat + (end.lat - start.lat) * fraction,
    lon: start.lon + (end.lon - start.lon) * fraction,
  };
}

function requestedPlanningAnchors(route: PlanningRoute): RequestedForecastAnchor[] {
  return planningForecastAnchorDistances(route).map((routeDistanceM) => ({
    ...planningRoutePointAt(route, routeDistanceM),
    routeDistanceM,
  }));
}

function requestUrl(
  anchors: readonly RequestedForecastAnchor[],
  baseUrl = BASE,
  providerModel?: string,
): string {
  const params = new URLSearchParams({
    latitude: anchors.map((anchor) => anchor.lat.toFixed(4)).join(','),
    longitude: anchors.map((anchor) => anchor.lon.toFixed(4)).join(','),
    hourly: OPEN_METEO_FORECAST_VARIABLES.join(','),
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
    timezone: 'auto',
    forecast_days: '3',
  });
  if (providerModel) params.set('models', providerModel);
  return `${baseUrl}?${params}`;
}

async function providerJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    const contentType = response.headers.get('content-type') ?? 'unknown content type';
    const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 96) || 'empty response';
    throw new Error(`Open-Meteo returned invalid JSON (${contentType}): ${preview}`);
  }
}

function waitForProviderRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Request aborted'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Request aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Network acquisition only; normalization remains pure and independently testable. */
export async function fetchRawOpenMeteoForecast(
  route: PlanningRoute,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<{
  payloads: RawOpenMeteoLocation[];
  requested: RequestedForecastAnchor[];
  fetchedAt: number;
  providerModel: string | null;
}> {
  const requested = requestedPlanningAnchors(route);
  let lastError: unknown;
  const requestPlans = [
    { providerModel: undefined, groups: [requested] },
    {
      providerModel: PROVIDER_MODEL_FALLBACK,
      groups: Array.from(
        { length: Math.ceil(requested.length / PROVIDER_FALLBACK_CHUNK_SIZE) },
        (_, index) =>
          requested.slice(
            index * PROVIDER_FALLBACK_CHUNK_SIZE,
            (index + 1) * PROVIDER_FALLBACK_CHUNK_SIZE,
          ),
      ),
    },
  ] as const;

  for (const plan of requestPlans) {
    const payloads: RawOpenMeteoLocation[] = [];
    let planFailed = false;
    for (const group of plan.groups) {
      let groupPayloads: RawOpenMeteoLocation[] | null = null;
      for (let attempt = 0; attempt < PROVIDER_ATTEMPTS_PER_MODEL; attempt += 1) {
        try {
          const response = await fetchWithDeadline(requestUrl(group, baseUrl, plan.providerModel), {
            signal,
          });
          if (!response.ok) {
            const error = new OpenMeteoHttpError(response.status);
            if (response.status !== 429 && response.status < 500) throw error;
            lastError = error;
          } else {
            const body = (await providerJson(response)) as
              RawOpenMeteoLocation | RawOpenMeteoLocation[];
            const received = Array.isArray(body) ? body : [body];
            if (received.length !== group.length) {
              throw new Error('Open-Meteo returned an unexpected number of locations');
            }
            groupPayloads = received;
            break;
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          if (error instanceof OpenMeteoHttpError && error.status !== 429 && error.status < 500) {
            throw error;
          }
          lastError = error;
        }
        if (attempt < PROVIDER_ATTEMPTS_PER_MODEL - 1) {
          await waitForProviderRetry(PROVIDER_RETRY_DELAY_MS, signal);
        }
      }
      if (groupPayloads === null) {
        planFailed = true;
        break;
      }
      payloads.push(...groupPayloads);
    }
    if (!planFailed) {
      return {
        payloads,
        requested,
        fetchedAt: Date.now(),
        providerModel: plan.providerModel ?? null,
      };
    }
  }
  throw lastError ?? new Error('Open-Meteo request failed');
}

export async function fetchNormalizedRouteForecast(
  route: PlanningRoute,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<FetchedRouteForecast> {
  const raw = await fetchRawOpenMeteoForecast(route, signal, baseUrl);
  const fetchId = contentIdentity({
    provider: 'open-meteo',
    providerModel: raw.providerModel,
    requested: raw.requested,
    fetchedAt: raw.fetchedAt,
  });
  return {
    field: normalizeOpenMeteoForecast(raw.payloads, raw.requested, {
      fetchId,
      fetchedAt: raw.fetchedAt,
      providerModel: raw.providerModel,
    }),
    timezone: raw.payloads[0]?.timezone ?? 'UTC',
  };
}
