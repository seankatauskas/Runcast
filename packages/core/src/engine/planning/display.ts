import { sunlightIntensityLevel, type SunlightIntensityLevel } from './presentation';
import type { CanopyModelMode, WoodlandEvidenceValue } from './types';
import type { RouteConditionsSample } from './pipeline';

export const AMBIENT_HEADWIND_DOMAIN_MS = 12;
export const AMBIENT_CROSSWIND_DOMAIN_MS = 10;

export interface WindPlotSample {
  headFraction: number;
  tailFraction: number;
  crossFraction: number;
  crossDirection: -1 | 0 | 1;
}

const clampUnit = (value: number) => Math.min(Math.max(value, 0), 1);

export const SUN_EXPOSURE_DISPLAY_MODEL_VERSION = 'sun-strip-canopy-intensity-v4' as const;

const FORECAST_SUNLIGHT_OPACITY_BY_INTENSITY: Record<SunlightIntensityLevel, number> = {
  none: 0,
  minimal: 0.28,
  low: 0.38,
  moderate: 0.68,
  high: 1,
};

export function forecastSunlightOpacity(level: SunlightIntensityLevel): number {
  return FORECAST_SUNLIGHT_OPACITY_BY_INTENSITY[level];
}

export interface SunExposureSegmentDisplay {
  version: typeof SUN_EXPOSURE_DISPLAY_MODEL_VERSION;
  daylight: boolean;
  forecastSunlight: boolean;
  intensityLevel: SunlightIntensityLevel;
  woodlandEvidence: WoodlandEvidenceValue;
  possibleShade: boolean;
  accessibilityReason: string;
}

export interface SunExposureDisplayBand {
  startDistanceM: number;
  endDistanceM: number;
  segmentDisplay: SunExposureSegmentDisplay;
}

/**
 * Reader-2 compatibility retains the categorical woodland mask. Once numeric
 * canopy is authoritative, the selected radiation already contains the
 * conservative canopy adjustment, so woodland must not hide the yellow bar.
 */
export function sunExposureDisplayForWoodlandEvidence(
  woodlandEvidence: WoodlandEvidenceValue,
  daylight = true,
  radiationWm2 = 0,
  canopyModelMode: CanopyModelMode = 'off',
): SunExposureSegmentDisplay {
  const intensityLevel = sunlightIntensityLevel(radiationWm2, daylight);
  if (!daylight) {
    return {
      version: SUN_EXPOSURE_DISPLAY_MODEL_VERSION,
      daylight,
      forecastSunlight: false,
      intensityLevel,
      woodlandEvidence,
      possibleShade: false,
      accessibilityReason: 'no forecast sun after sunset',
    };
  }
  if (canopyModelMode !== 'active' && woodlandEvidence === 'mapped-woodland') {
    return {
      version: SUN_EXPOSURE_DISPLAY_MODEL_VERSION,
      daylight,
      forecastSunlight: false,
      intensityLevel,
      woodlandEvidence,
      possibleShade: true,
      accessibilityReason: 'possible shade based on mapped woodland',
    };
  }
  return {
    version: SUN_EXPOSURE_DISPLAY_MODEL_VERSION,
    daylight,
    forecastSunlight: true,
    intensityLevel,
    woodlandEvidence,
    possibleShade: false,
    accessibilityReason:
      canopyModelMode === 'active'
        ? 'forecast sunlight shown at the estimated canopy-adjusted intensity'
        : woodlandEvidence === 'unknown'
          ? 'sun shown conservatively because shade evidence is unavailable'
          : 'sun shown because there is no mapped woodland',
  };
}

function segmentEvidence(
  start: WoodlandEvidenceValue,
  end: WoodlandEvidenceValue,
): WoodlandEvidenceValue {
  return start === end ? start : 'unknown';
}

/** Builds direction-independent possible-shade and local sunlight bands from adjacent samples. */
export function buildSunExposureDisplayBands(
  samples: readonly Pick<
    RouteConditionsSample,
    'distanceM' | 'daylight' | 'woodlandEvidence' | 'radiationWm2'
  >[],
  canopyModelMode: CanopyModelMode = 'off',
): SunExposureDisplayBand[] {
  const bands: SunExposureDisplayBand[] = [];
  const appendBand = (
    startDistanceM: number,
    endDistanceM: number,
    woodlandEvidence: WoodlandEvidenceValue,
    daylight: boolean,
    radiationWm2: number,
  ) => {
    const segmentDisplay = sunExposureDisplayForWoodlandEvidence(
      woodlandEvidence,
      daylight,
      radiationWm2,
      canopyModelMode,
    );
    const previous = bands.at(-1);
    if (
      previous?.segmentDisplay.forecastSunlight === segmentDisplay.forecastSunlight &&
      previous.segmentDisplay.possibleShade === segmentDisplay.possibleShade &&
      previous.segmentDisplay.daylight === segmentDisplay.daylight &&
      previous.segmentDisplay.intensityLevel === segmentDisplay.intensityLevel
    ) {
      previous.endDistanceM = endDistanceM;
      return;
    }
    bands.push({ startDistanceM, endDistanceM, segmentDisplay });
  };
  for (let index = 1; index < samples.length; index += 1) {
    const start = samples[index - 1];
    const end = samples[index];
    const evidence = segmentEvidence(start.woodlandEvidence, end.woodlandEvidence);
    const radiationAt = (fraction: number) =>
      start.radiationWm2 + (end.radiationWm2 - start.radiationWm2) * fraction;
    if (start.daylight !== end.daylight) {
      const midpointDistanceM = (start.distanceM + end.distanceM) / 2;
      appendBand(start.distanceM, midpointDistanceM, evidence, start.daylight, radiationAt(0.25));
      appendBand(midpointDistanceM, end.distanceM, evidence, end.daylight, radiationAt(0.75));
    } else {
      appendBand(start.distanceM, end.distanceM, evidence, start.daylight, radiationAt(0.5));
    }
  }
  return bands;
}

export function windPlotSample(
  sample: Pick<RouteConditionsSample, 'ambientHeadwindMs' | 'ambientCrosswindMs'>,
): WindPlotSample {
  return {
    headFraction: clampUnit(sample.ambientHeadwindMs / AMBIENT_HEADWIND_DOMAIN_MS),
    tailFraction: clampUnit(-sample.ambientHeadwindMs / AMBIENT_HEADWIND_DOMAIN_MS),
    crossFraction: clampUnit(Math.abs(sample.ambientCrosswindMs) / AMBIENT_CROSSWIND_DOMAIN_MS),
    crossDirection: Math.sign(sample.ambientCrosswindMs) as -1 | 0 | 1,
  };
}
