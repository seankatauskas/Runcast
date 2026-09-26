import type {
  CanopyEvidenceProfile,
  CanopyModelMode,
  CanopyRegion,
  PlanningRoute,
  ReasonCode,
} from './types';

export const CANOPY_DATASET_YEAR = 2025 as const;
export const CANOPY_DATASET_VERSION = 'v2025-6' as const;
export const CANOPY_SOURCE_RESOLUTION_M = 30 as const;
export const CANOPY_DIRECT_BLOCKING_COEFFICIENT = 0.65;
export const CANOPY_LOWER_CONFIDENCE_Z = 1.645;
export const CANOPY_WINTER_LEAF_FLOOR = 0.25;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

function utcDayOfYear(at: number): number {
  const date = new Date(at);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((at - start) / 86_400_000) + 1;
}

/**
 * Conservative northern-hemisphere leaf factor from latitude and UTC date.
 * Tropical locations at/below 25 N remain fully leafed. From 25–50 N the
 * green-up and senescence dates interpolate linearly; higher latitudes use
 * the 50 N timing and a 0.25 winter floor.
 */
export function seasonalLeafFactor(latitude: number, at: number): number {
  if (!Number.isFinite(latitude) || !Number.isFinite(at)) {
    throw new TypeError('latitude and time must be finite');
  }
  if (latitude <= 25) return 1;
  const normalizedLatitude = clamp((latitude - 25) / 25, 0, 1);
  const greenUpStart = 70 + 50 * normalizedLatitude;
  const fullLeafStart = greenUpStart + 30;
  const senescenceStart = 330 - 60 * normalizedLatitude;
  const winterStart = senescenceStart + 30;
  const day = utcDayOfYear(at);
  if (day < greenUpStart || day >= winterStart) return CANOPY_WINTER_LEAF_FLOOR;
  if (day < fullLeafStart) {
    const progress = (day - greenUpStart) / 30;
    return CANOPY_WINTER_LEAF_FLOOR + (1 - CANOPY_WINTER_LEAF_FLOOR) * progress;
  }
  if (day < senescenceStart) return 1;
  const progress = (day - senescenceStart) / 30;
  return 1 - (1 - CANOPY_WINTER_LEAF_FLOOR) * progress;
}

export interface CanopySample {
  canopyPct: number | null;
  standardErrorPct: number | null;
}

export function canopyEvidenceAt(profile: CanopyEvidenceProfile, distanceM: number): CanopySample {
  if (!profile.routeDistanceM.length || !Number.isFinite(distanceM)) {
    return { canopyPct: null, standardErrorPct: null };
  }
  let low = 0;
  let high = profile.routeDistanceM.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (profile.routeDistanceM[middle] < distanceM) low = middle + 1;
    else high = middle;
  }
  const upper = low;
  const lower = Math.max(upper - 1, 0);
  const index =
    Math.abs(profile.routeDistanceM[upper] - distanceM) <
    Math.abs(profile.routeDistanceM[lower] - distanceM)
      ? upper
      : lower;
  return {
    canopyPct: profile.canopyPct[index] ?? null,
    standardErrorPct: profile.standardErrorPct[index] ?? null,
  };
}

export function lowerCanopyFraction(sample: CanopySample): number {
  if (sample.canopyPct === null || sample.standardErrorPct === null) return 0;
  return clamp(
    (sample.canopyPct - CANOPY_LOWER_CONFIDENCE_Z * sample.standardErrorPct) / 100,
    0,
    1,
  );
}

export function blockedDirectFraction(
  input: CanopySample & { latitude: number; at: number },
): number {
  return (
    CANOPY_DIRECT_BLOCKING_COEFFICIENT *
    lowerCanopyFraction(input) *
    seasonalLeafFactor(input.latitude, input.at)
  );
}

export interface CanopyAdjustedRadiation {
  openSkyShortwaveWm2: number;
  adjustedShortwaveWm2: number;
  openSkyDirectNormalWm2: number;
  adjustedDirectNormalWm2: number;
  diffuseWm2: number;
  blockedDirectFraction: number;
}

export function adjustRadiationForCanopy(input: {
  shortwaveWm2: number;
  directNormalWm2: number;
  diffuseWm2: number;
  canopyPct: number | null;
  standardErrorPct: number | null;
  latitude: number;
  at: number;
}): CanopyAdjustedRadiation {
  const blocked = blockedDirectFraction(input);
  const openSkyShortwaveWm2 = Math.max(0, input.shortwaveWm2);
  const diffuseWm2 = clamp(input.diffuseWm2, 0, openSkyShortwaveWm2);
  const directHorizontalWm2 = Math.max(0, openSkyShortwaveWm2 - diffuseWm2);
  const adjustedShortwaveWm2 = Math.min(
    openSkyShortwaveWm2,
    diffuseWm2 + directHorizontalWm2 * (1 - blocked),
  );
  const openSkyDirectNormalWm2 = Math.max(0, input.directNormalWm2);
  return {
    openSkyShortwaveWm2,
    adjustedShortwaveWm2,
    openSkyDirectNormalWm2,
    adjustedDirectNormalWm2: openSkyDirectNormalWm2 * (1 - blocked),
    diffuseWm2,
    blockedDirectFraction: blocked,
  };
}

export function selectedRadiation(
  radiation: CanopyAdjustedRadiation,
  mode: CanopyModelMode,
): { shortwaveWm2: number; directNormalWm2: number } {
  return mode === 'active'
    ? {
        shortwaveWm2: radiation.adjustedShortwaveWm2,
        directNormalWm2: radiation.adjustedDirectNormalWm2,
      }
    : {
        shortwaveWm2: radiation.openSkyShortwaveWm2,
        directNormalWm2: radiation.openSkyDirectNormalWm2,
      };
}

export function unavailableCanopyEvidence(
  route: PlanningRoute,
  coordinateHash: string,
  reasons: ReasonCode[] = ['canopy.unavailable'],
  region: CanopyRegion = 'unsupported',
): CanopyEvidenceProfile {
  const count = Math.max(2, Math.ceil(route.totalDistanceM / CANOPY_SOURCE_RESOLUTION_M) + 1);
  const interval = route.totalDistanceM / (count - 1);
  return {
    schemaVersion: 3,
    routeDistanceM: Array.from({ length: count }, (_, index) => interval * index),
    canopyPct: Array.from({ length: count }, () => null),
    standardErrorPct: Array.from({ length: count }, () => null),
    provider: 'usda-fs-science-tcc',
    region,
    datasetYear: CANOPY_DATASET_YEAR,
    datasetVersion: CANOPY_DATASET_VERSION,
    sourceResolutionM: CANOPY_SOURCE_RESOLUTION_M,
    acquiredAt: null,
    coordinateHash,
    completeness: 'unavailable',
    reasons,
  };
}

export function reverseCanopyEvidence(
  profile: CanopyEvidenceProfile,
  totalDistanceM: number,
): CanopyEvidenceProfile {
  const tuples = profile.routeDistanceM.map((distanceM, index) => ({
    distanceM: Math.max(0, totalDistanceM - distanceM),
    canopyPct: profile.canopyPct[index] ?? null,
    standardErrorPct: profile.standardErrorPct[index] ?? null,
  }));
  tuples.reverse();
  return {
    ...profile,
    routeDistanceM: tuples.map((tuple) => tuple.distanceM),
    canopyPct: tuples.map((tuple) => tuple.canopyPct),
    standardErrorPct: tuples.map((tuple) => tuple.standardErrorPct),
  };
}
