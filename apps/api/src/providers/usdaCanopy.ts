import { setTimeout as delay } from 'node:timers/promises';
import {
  CANOPY_DATASET_VERSION,
  CANOPY_DATASET_YEAR,
  CANOPY_SOURCE_RESOLUTION_M,
  segmentIndexAt,
  unavailableCanopyEvidence,
  type CanopyEvidenceProfile,
  type CanopyRegion,
  type PlanningRoute,
} from '@runcast/core';

export const USDA_CANOPY_PROVIDER = 'usda-fs-science-tcc';
export const USDA_CANOPY_SAMPLE_LIMIT = 1_000;
// getSamples is GET-only on this service. Stay well below the service's
// 1,000-point result ceiling so encoded multipoint URLs also clear its WAF.
export const USDA_CANOPY_REQUEST_BATCH_SIZE = 20;
export const USDA_CANOPY_TIMEOUT_MS = 15_000;
export const USDA_CANOPY_2025_TIME = Date.UTC(2025, 0, 1);

const IMAGE_SERVICE_ROOT = 'https://imagery.geoplatform.gov/iipp/rest/services/Vegetation';

export interface CanopyRegionServices {
  canopyUrl: string;
  standardErrorUrl: string;
}

export const USDA_CANOPY_SERVICES: Readonly<
  Record<Exclude<CanopyRegion, 'unsupported'>, CanopyRegionServices>
> = Object.freeze({
  conus: {
    canopyUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_Science_TCC_CONUS/ImageServer`,
    standardErrorUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_TCC_Science_SE_CONUS/ImageServer`,
  },
  seak: {
    canopyUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_Science_TCC_SEAK/ImageServer`,
    standardErrorUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_TCC_Science_SE_SEAK/ImageServer`,
  },
  hawaii: {
    canopyUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_Science_TCC_Hawaii/ImageServer`,
    standardErrorUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_TCC_Science_SE_Hawaii/ImageServer`,
  },
  prusvi: {
    canopyUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_Science_TCC_PRUSVI/ImageServer`,
    standardErrorUrl: `${IMAGE_SERVICE_ROOT}/USFS_EDW_TCC_Science_SE_PRUSVI/ImageServer`,
  },
});

interface ArcGisSample {
  locationId?: number;
  value?: string | number | null;
}

interface ArcGisSamplesResponse {
  samples?: ArcGisSample[];
  error?: { code?: number; message?: string };
}

export interface ImageServiceCatalogMetadata {
  serviceDescription?: string;
  timeInfo?: { timeExtent?: [number, number] };
  pixelSizeX?: number;
  maxRecordCount?: number;
}

export function resolvePinnedCanopyCatalog(metadata: ImageServiceCatalogMetadata): {
  datasetYear: 2025;
  datasetVersion: 'v2025-6';
  sourceResolutionM: 30;
} {
  const extent = metadata.timeInfo?.timeExtent;
  if (!extent || extent[0] > USDA_CANOPY_2025_TIME || extent[1] < USDA_CANOPY_2025_TIME) {
    throw new Error('USDA canopy catalog does not contain the pinned 2025 layer');
  }
  if (!metadata.serviceDescription?.includes(CANOPY_DATASET_VERSION)) {
    throw new Error(`USDA canopy catalog is not ${CANOPY_DATASET_VERSION}`);
  }
  if (metadata.pixelSizeX !== CANOPY_SOURCE_RESOLUTION_M) {
    throw new Error('USDA canopy catalog source resolution changed');
  }
  if ((metadata.maxRecordCount ?? USDA_CANOPY_SAMPLE_LIMIT) < USDA_CANOPY_SAMPLE_LIMIT) {
    throw new Error('USDA canopy catalog sample limit is below the required batch size');
  }
  return {
    datasetYear: CANOPY_DATASET_YEAR,
    datasetVersion: CANOPY_DATASET_VERSION,
    sourceResolutionM: CANOPY_SOURCE_RESOLUTION_M,
  };
}

function coordinateRegion(lat: number, lon: number): CanopyRegion {
  if (lat >= 24 && lat <= 50.5 && lon >= -125.5 && lon <= -66) return 'conus';
  if (lat >= 54 && lat <= 61 && lon >= -142 && lon <= -129) return 'seak';
  if (lat >= 18.5 && lat <= 22.5 && lon >= -161.5 && lon <= -154) return 'hawaii';
  if (lat >= 17.5 && lat <= 18.7 && lon >= -68.2 && lon <= -64.3) return 'prusvi';
  return 'unsupported';
}

export function canopyRegionForRoute(route: PlanningRoute): CanopyRegion {
  const regions = new Set(route.part.points.map((point) => coordinateRegion(point.lat, point.lon)));
  return regions.size === 1 ? [...regions][0] : 'unsupported';
}

export interface CanopyRouteSamplePoint {
  distanceM: number;
  lat: number;
  lon: number;
}

export function interpolateCanopyRoutePoints(
  route: PlanningRoute,
  spacingM = CANOPY_SOURCE_RESOLUTION_M,
): CanopyRouteSamplePoint[] {
  if (!Number.isFinite(spacingM) || spacingM <= 0) {
    throw new TypeError('canopy spacing must be positive');
  }
  const intervalCount = Math.max(1, Math.ceil(route.totalDistanceM / spacingM));
  const intervalM = route.totalDistanceM / intervalCount;
  return Array.from({ length: intervalCount + 1 }, (_, sampleIndex) => {
    const distanceM = intervalM * sampleIndex;
    const index = segmentIndexAt(route.cumulativeDistanceM, distanceM);
    const startDistance = route.cumulativeDistanceM[index];
    const endDistance = route.cumulativeDistanceM[index + 1];
    const fraction =
      endDistance > startDistance ? (distanceM - startDistance) / (endDistance - startDistance) : 0;
    const start = route.part.points[index];
    const end = route.part.points[index + 1];
    return {
      distanceM,
      lat: start.lat + (end.lat - start.lat) * fraction,
      lon: start.lon + (end.lon - start.lon) * fraction,
    };
  });
}

export function canopyValue(value: ArcGisSample['value']): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function standardErrorValue(value: ArcGisSample['value']): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 65_534 ? parsed / 100 : null;
}

function requestUrl(serviceUrl: string, points: readonly CanopyRouteSamplePoint[]): string {
  const search = new URLSearchParams({
    geometryType: 'esriGeometryMultipoint',
    geometry: JSON.stringify({
      points: points.map((point) => [point.lon, point.lat]),
      spatialReference: { wkid: 4326 },
    }),
    time: String(USDA_CANOPY_2025_TIME),
    interpolation: 'RSP_NearestNeighbor',
    returnFirstValueOnly: 'true',
    f: 'json',
  });
  return `${serviceUrl}/getSamples?${search.toString()}`;
}

async function getSamples(
  fetchImpl: typeof fetch,
  serviceUrl: string,
  points: readonly CanopyRouteSamplePoint[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ArcGisSamplesResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(requestUrl(serviceUrl, points), {
      headers: {
        accept: 'application/json',
        'user-agent': 'Runcast/0.3 canopy-evidence',
      },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    if (!response.ok) throw new Error(`USDA canopy provider returned ${response.status}`);
    const body = (await response.json()) as ArcGisSamplesResponse;
    if (body.error) throw new Error(body.error.message ?? 'USDA canopy provider error');
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetries<T>(
  work: () => Promise<T>,
  retries: number,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await work();
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
      if (attempt < retries) {
        await delay(Math.min(250 * 2 ** attempt, 2_000), undefined, { signal });
      }
    }
  }
  throw lastError;
}

function samplesByLocationId(samples: ArcGisSample[] | undefined): Map<number, ArcGisSample> {
  return new Map(
    (samples ?? []).flatMap((sample) =>
      Number.isInteger(sample.locationId) ? [[sample.locationId!, sample] as const] : [],
    ),
  );
}

export interface AcquireCanopyEvidenceOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  acquiredAt?: number;
}

export async function acquireCanopyEvidence(
  route: PlanningRoute,
  coordinateHash: string,
  options: AcquireCanopyEvidenceOptions = {},
): Promise<CanopyEvidenceProfile> {
  options.signal?.throwIfAborted();
  const region = canopyRegionForRoute(route);
  if (region === 'unsupported') {
    return unavailableCanopyEvidence(route, coordinateHash, [
      'canopy.unavailable',
      'canopy.unsupported-region',
    ]);
  }
  const points = interpolateCanopyRoutePoints(route);
  const canopyPct: Array<number | null> = [];
  const standardErrorPct: Array<number | null> = [];
  const services = USDA_CANOPY_SERVICES[region];
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? USDA_CANOPY_TIMEOUT_MS;
  const retries = options.retries ?? 2;

  for (let offset = 0; offset < points.length; offset += USDA_CANOPY_REQUEST_BATCH_SIZE) {
    const batch = points.slice(offset, offset + USDA_CANOPY_REQUEST_BATCH_SIZE);
    const [canopyResponse, standardErrorResponse] = await Promise.all([
      withRetries(
        () => getSamples(fetchImpl, services.canopyUrl, batch, timeoutMs, options.signal),
        retries,
        options.signal,
      ),
      withRetries(
        () => getSamples(fetchImpl, services.standardErrorUrl, batch, timeoutMs, options.signal),
        retries,
        options.signal,
      ),
    ]);
    const canopySamples = samplesByLocationId(canopyResponse.samples);
    const errorSamples = samplesByLocationId(standardErrorResponse.samples);
    const canopyLocationIdBase = canopySamples.has(0) ? 0 : 1;
    const errorLocationIdBase = errorSamples.has(0) ? 0 : 1;
    for (let index = 0; index < batch.length; index += 1) {
      // ArcGIS location IDs are one-based for multipoint requests. Accept
      // zero-based IDs too because older service versions returned those.
      const canopySample = canopySamples.get(index + canopyLocationIdBase);
      const errorSample = errorSamples.get(index + errorLocationIdBase);
      const canopy = canopyValue(canopySample?.value);
      const standardError = standardErrorValue(errorSample?.value);
      const aligned = canopy !== null && standardError !== null;
      canopyPct.push(aligned ? canopy : null);
      standardErrorPct.push(aligned ? standardError : null);
    }
  }

  const availableCount = canopyPct.filter((value) => value !== null).length;
  const completeness =
    availableCount === canopyPct.length
      ? 'complete'
      : availableCount > 0
        ? 'partial'
        : 'unavailable';
  return {
    schemaVersion: 3,
    routeDistanceM: points.map((point) => point.distanceM),
    canopyPct,
    standardErrorPct,
    provider: USDA_CANOPY_PROVIDER,
    region,
    datasetYear: CANOPY_DATASET_YEAR,
    datasetVersion: CANOPY_DATASET_VERSION,
    sourceResolutionM: CANOPY_SOURCE_RESOLUTION_M,
    acquiredAt: options.acquiredAt ?? Date.now(),
    coordinateHash,
    completeness,
    reasons:
      completeness === 'complete'
        ? []
        : completeness === 'partial'
          ? ['canopy.partial']
          : ['canopy.unavailable'],
  };
}
