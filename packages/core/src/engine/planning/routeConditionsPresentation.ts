import type { RouteConditionsProfile, RouteConditionsSample } from './pipeline';
import { sunlightIntensityLevel, type SunlightIntensityLevel } from './presentation';

export type RouteWindClass = 'calm' | 'headwind' | 'tailwind' | 'crosswind';
export type RouteWindStory =
  | 'headwind-out-tailwind-home'
  | 'tailwind-out-headwind-home'
  | 'mostly-headwind'
  | 'mostly-tailwind'
  | 'mostly-crosswind'
  | 'mostly-calm'
  | 'mixed';

export interface RouteConditionsSummary {
  forecastSunlight: {
    meanIntensityWm2: number;
    meanDirectNormalWm2: number;
    meanDiffuseWm2: number;
    level: SunlightIntensityLevel;
    secondsByLevel: Record<SunlightIntensityLevel, number>;
  };
  woodlandEvidence: RouteConditionsProfile['woodland'];
  wind: {
    story: RouteWindStory;
    secondsByClass: Record<RouteWindClass, number>;
    meanHeadwindMs: number;
    maximumHeadwindMs: number;
    maximumTailwindMs: number;
    meanCrosswindMs: number;
    meanAbsoluteCrosswindMs: number;
    crosswindSide: 'left' | 'right' | null;
    peakGustMs: number;
  };
}

export interface RouteConditionSplit {
  index: number;
  startDistanceM: number;
  endDistanceM: number;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  speedMs: number;
  meanAirTemperatureC: number;
  meanFeelsLikeC: number;
  meanSunlightIntensityWm2: number;
  forecastSunlightLevel: SunlightIntensityLevel;
  woodlandEvidenceFraction: number | null;
  meanCanopyPct: number | null;
  meanBlockedDirectFraction: number | null;
  canopyAvailableFraction: number;
  windClass: RouteWindClass;
  meanHeadwindMs: number;
  meanCrosswindMs: number;
  crosswindSide: 'left' | 'right' | null;
  peakGustMs: number;
}

const SUNLIGHT_INTENSITY_THRESHOLDS_WM2 = [50, 200, 600] as const;
const ROUTE_WIND_CALM_MS = 1.5;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function profileDurationSeconds(samples: readonly RouteConditionsSample[]): number {
  if (samples.length < 2)
    throw new TypeError('route conditions profile needs at least two samples');
  const durationSeconds = (samples.at(-1)!.time - samples[0].time) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('route conditions samples must have increasing times');
  }
  return durationSeconds;
}

function timeWeightedMean(
  samples: readonly RouteConditionsSample[],
  pick: (sample: RouteConditionsSample) => number,
): number {
  const durationSeconds = profileDurationSeconds(samples);
  let integral = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const elapsedSeconds = (samples[index].time - samples[index - 1].time) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      throw new TypeError('route conditions samples must have increasing times');
    }
    integral += ((pick(samples[index - 1]) + pick(samples[index])) / 2) * elapsedSeconds;
  }
  return integral / durationSeconds;
}

function sunlightIntensityBandDurations(
  samples: readonly RouteConditionsSample[],
): Record<SunlightIntensityLevel, number> {
  profileDurationSeconds(samples);
  const durations: Record<SunlightIntensityLevel, number> = {
    none: 0,
    minimal: 0,
    low: 0,
    moderate: 0,
    high: 0,
  };
  for (let index = 1; index < samples.length; index += 1) {
    const start = samples[index - 1];
    const end = samples[index];
    const elapsedSeconds = (end.time - start.time) / 1000;
    const delta = end.radiationWm2 - start.radiationWm2;
    const cuts = [0, 1];
    if (start.daylight !== end.daylight) cuts.push(0.5);
    if (delta !== 0) {
      for (const threshold of SUNLIGHT_INTENSITY_THRESHOLDS_WM2) {
        const fraction = (threshold - start.radiationWm2) / delta;
        if (fraction > 0 && fraction < 1) cuts.push(fraction);
      }
    }
    cuts.sort((a, b) => a - b);
    for (let cutIndex = 1; cutIndex < cuts.length; cutIndex += 1) {
      const from = cuts[cutIndex - 1];
      const to = cuts[cutIndex];
      const midpoint = (from + to) / 2;
      const midpointRadiation = start.radiationWm2 + delta * midpoint;
      const daylight = midpoint < 0.5 ? start.daylight : end.daylight;
      durations[sunlightIntensityLevel(midpointRadiation, daylight)] +=
        (to - from) * elapsedSeconds;
    }
  }
  return durations;
}

export function classifyRouteWind(
  sample: Pick<RouteConditionsSample, 'ambientWindSpeedMs' | 'ambientHeadwindMs'>,
): RouteWindClass {
  requireFinite(sample.ambientWindSpeedMs, 'ambientWindSpeedMs');
  requireFinite(sample.ambientHeadwindMs, 'ambientHeadwindMs');
  if (sample.ambientWindSpeedMs < 0) throw new TypeError('ambientWindSpeedMs must be nonnegative');
  if (sample.ambientWindSpeedMs < ROUTE_WIND_CALM_MS) return 'calm';
  const alongFraction = sample.ambientHeadwindMs / sample.ambientWindSpeedMs;
  if (alongFraction >= 0.5) return 'headwind';
  if (alongFraction <= -0.5) return 'tailwind';
  return 'crosswind';
}

function windClassDurations(
  samples: readonly RouteConditionsSample[],
  fromTime = samples[0].time,
  untilTime = samples.at(-1)!.time,
): Record<RouteWindClass, number> {
  const durations: Record<RouteWindClass, number> = {
    calm: 0,
    headwind: 0,
    tailwind: 0,
    crosswind: 0,
  };
  for (let index = 1; index < samples.length; index += 1) {
    const startTime = Math.max(samples[index - 1].time, fromTime);
    const endTime = Math.min(samples[index].time, untilTime);
    if (endTime <= startTime) continue;
    const midpoint = {
      ambientWindSpeedMs:
        (samples[index - 1].ambientWindSpeedMs + samples[index].ambientWindSpeedMs) / 2,
      ambientHeadwindMs:
        (samples[index - 1].ambientHeadwindMs + samples[index].ambientHeadwindMs) / 2,
    };
    durations[classifyRouteWind(midpoint)] += (endTime - startTime) / 1000;
  }
  return durations;
}

function dominantWindClass(
  durations: Record<RouteWindClass, number>,
  minimumFraction: number,
): RouteWindClass | null {
  const total = Object.values(durations).reduce((sum, duration) => sum + duration, 0);
  if (total <= 0) return null;
  const [windClass, duration] = (
    Object.entries(durations) as Array<[RouteWindClass, number]>
  ).reduce((highest, candidate) => (candidate[1] > highest[1] ? candidate : highest));
  return duration / total >= minimumFraction ? windClass : null;
}

function routeWindStory(
  samples: readonly RouteConditionsSample[],
  secondsByClass: Record<RouteWindClass, number>,
): RouteWindStory {
  const midpoint = (samples[0].time + samples.at(-1)!.time) / 2;
  const first = dominantWindClass(windClassDurations(samples, samples[0].time, midpoint), 0.6);
  const second = dominantWindClass(
    windClassDurations(samples, midpoint, samples.at(-1)!.time),
    0.6,
  );
  if (first === 'headwind' && second === 'tailwind') return 'headwind-out-tailwind-home';
  if (first === 'tailwind' && second === 'headwind') return 'tailwind-out-headwind-home';
  const overall = dominantWindClass(secondsByClass, 0.5);
  if (overall === 'headwind') return 'mostly-headwind';
  if (overall === 'tailwind') return 'mostly-tailwind';
  if (overall === 'crosswind') return 'mostly-crosswind';
  if (overall === 'calm') return 'mostly-calm';
  return 'mixed';
}

export function presentRouteConditionsProfile(
  profile: RouteConditionsProfile,
): RouteConditionsSummary {
  const { samples } = profile;
  profileDurationSeconds(samples);
  const meanIntensityWm2 = timeWeightedMean(samples, (sample) => sample.radiationWm2);
  const secondsByLevel = sunlightIntensityBandDurations(samples);
  const hasDaylight = samples.some((sample) => sample.daylight);
  const secondsByClass = windClassDurations(samples);
  const meanCrosswindMs = timeWeightedMean(samples, (sample) => sample.ambientCrosswindMs);
  return {
    forecastSunlight: {
      meanIntensityWm2,
      meanDirectNormalWm2: timeWeightedMean(samples, (sample) => sample.directNormalRadiationWm2),
      meanDiffuseWm2: timeWeightedMean(samples, (sample) => sample.diffuseRadiationWm2),
      level: sunlightIntensityLevel(meanIntensityWm2, hasDaylight),
      secondsByLevel,
    },
    woodlandEvidence: profile.woodland,
    wind: {
      story: routeWindStory(samples, secondsByClass),
      secondsByClass,
      meanHeadwindMs: timeWeightedMean(samples, (sample) => sample.ambientHeadwindMs),
      maximumHeadwindMs: Math.max(0, ...samples.map((sample) => sample.ambientHeadwindMs)),
      maximumTailwindMs: Math.max(0, ...samples.map((sample) => -sample.ambientHeadwindMs)),
      meanCrosswindMs,
      meanAbsoluteCrosswindMs: timeWeightedMean(samples, (sample) =>
        Math.abs(sample.ambientCrosswindMs),
      ),
      crosswindSide:
        Math.abs(meanCrosswindMs) < 0.5 ? null : meanCrosswindMs > 0 ? 'left' : 'right',
      peakGustMs: Math.max(...samples.map((sample) => sample.gustMs)),
    },
  };
}

function interpolateSampleAtDistance(
  samples: readonly RouteConditionsSample[],
  distanceM: number,
): RouteConditionsSample {
  if (distanceM <= samples[0].distanceM) return { ...samples[0], distanceM };
  if (distanceM >= samples.at(-1)!.distanceM) return { ...samples.at(-1)!, distanceM };
  const upperIndex = samples.findIndex((sample) => sample.distanceM >= distanceM);
  const lower = samples[upperIndex - 1];
  const upper = samples[upperIndex];
  const fraction = (distanceM - lower.distanceM) / (upper.distanceM - lower.distanceM);
  const interpolate = (start: number, end: number) => start + (end - start) * fraction;
  const interpolateOptional = (
    start: number | null | undefined,
    end: number | null | undefined,
  ): number | null | undefined => {
    if (start === undefined || end === undefined) return undefined;
    if (start === null || end === null) return null;
    return interpolate(start, end);
  };
  const interpolateDefined = (
    start: number | undefined,
    end: number | undefined,
  ): number | undefined =>
    start === undefined || end === undefined ? undefined : interpolate(start, end);
  return {
    distanceM,
    time: interpolate(lower.time, upper.time),
    daylight: fraction < 0.5 ? lower.daylight : upper.daylight,
    elevationM:
      lower.elevationM === null || upper.elevationM === null
        ? null
        : interpolate(lower.elevationM, upper.elevationM),
    woodlandEvidence: fraction < 0.5 ? lower.woodlandEvidence : upper.woodlandEvidence,
    canopyPct: interpolateOptional(lower.canopyPct, upper.canopyPct),
    standardErrorPct: interpolateOptional(lower.standardErrorPct, upper.standardErrorPct),
    blockedDirectFraction: interpolateDefined(
      lower.blockedDirectFraction,
      upper.blockedDirectFraction,
    ),
    openSkyRadiationWm2: interpolateDefined(lower.openSkyRadiationWm2, upper.openSkyRadiationWm2),
    canopyAdjustedRadiationWm2: interpolateDefined(
      lower.canopyAdjustedRadiationWm2,
      upper.canopyAdjustedRadiationWm2,
    ),
    airTemperatureC: interpolate(lower.airTemperatureC, upper.airTemperatureC),
    feelsLikeC: interpolate(lower.feelsLikeC, upper.feelsLikeC),
    radiationWm2: interpolate(lower.radiationWm2, upper.radiationWm2),
    directNormalRadiationWm2: interpolate(
      lower.directNormalRadiationWm2,
      upper.directNormalRadiationWm2,
    ),
    diffuseRadiationWm2: interpolate(lower.diffuseRadiationWm2, upper.diffuseRadiationWm2),
    precipitationProbabilityPct: interpolate(
      lower.precipitationProbabilityPct,
      upper.precipitationProbabilityPct,
    ),
    precipitationRateMmH: interpolate(lower.precipitationRateMmH, upper.precipitationRateMmH),
    gustMs: interpolate(lower.gustMs, upper.gustMs),
    ambientWindSpeedMs: interpolate(lower.ambientWindSpeedMs, upper.ambientWindSpeedMs),
    ambientHeadwindMs: interpolate(lower.ambientHeadwindMs, upper.ambientHeadwindMs),
    ambientCrosswindMs: interpolate(lower.ambientCrosswindMs, upper.ambientCrosswindMs),
    apparentAirflowMs: interpolate(lower.apparentAirflowMs, upper.apparentAirflowMs),
    apparentCrossTrackMs: interpolate(lower.apparentCrossTrackMs, upper.apparentCrossTrackMs),
    aerodynamicOppositionDelta: interpolate(
      lower.aerodynamicOppositionDelta,
      upper.aerodynamicOppositionDelta,
    ),
  };
}

function splitWoodlandFraction(
  profile: RouteConditionsProfile,
  samples: readonly RouteConditionsSample[],
): number | null {
  if (profile.woodland.completeness !== 'complete') return null;
  let mappedDistanceM = 0;
  let knownDistanceM = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const distanceM = samples[index].distanceM - samples[index - 1].distanceM;
    const evidence = samples[index - 1].woodlandEvidence;
    if (evidence === 'unknown') return null;
    knownDistanceM += distanceM;
    if (evidence === 'mapped-woodland') mappedDistanceM += distanceM;
  }
  return knownDistanceM > 0 ? mappedDistanceM / knownDistanceM : null;
}

function splitCanopySummary(samples: readonly RouteConditionsSample[]): {
  meanCanopyPct: number | null;
  meanBlockedDirectFraction: number | null;
  availableFraction: number;
} {
  let availableDistanceM = 0;
  let canopyDistanceIntegral = 0;
  let blockedDistanceIntegral = 0;
  let totalDistanceM = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const distanceM = samples[index].distanceM - samples[index - 1].distanceM;
    totalDistanceM += distanceM;
    const start = samples[index - 1];
    const end = samples[index];
    if (
      start.canopyPct == null ||
      end.canopyPct == null ||
      start.blockedDirectFraction === undefined ||
      end.blockedDirectFraction === undefined
    ) {
      continue;
    }
    availableDistanceM += distanceM;
    canopyDistanceIntegral += ((start.canopyPct + end.canopyPct) / 2) * distanceM;
    blockedDistanceIntegral +=
      ((start.blockedDirectFraction + end.blockedDirectFraction) / 2) * distanceM;
  }
  return {
    meanCanopyPct: availableDistanceM > 0 ? canopyDistanceIntegral / availableDistanceM : null,
    meanBlockedDirectFraction:
      availableDistanceM > 0 ? blockedDistanceIntegral / availableDistanceM : null,
    availableFraction: totalDistanceM > 0 ? availableDistanceM / totalDistanceM : 0,
  };
}

export function buildRouteConditionSplits(
  profile: RouteConditionsProfile,
  splitLengthM: number,
): RouteConditionSplit[] {
  if (!Number.isFinite(splitLengthM) || splitLengthM <= 0) {
    throw new TypeError('splitLengthM must be positive');
  }
  profileDurationSeconds(profile.samples);
  const totalDistanceM = profile.samples.at(-1)!.distanceM;
  if (totalDistanceM <= 0) return [];
  const splits: RouteConditionSplit[] = [];
  for (let startDistanceM = 0; startDistanceM < totalDistanceM; startDistanceM += splitLengthM) {
    const endDistanceM = Math.min(startDistanceM + splitLengthM, totalDistanceM);
    const samples = [
      interpolateSampleAtDistance(profile.samples, startDistanceM),
      ...profile.samples.filter(
        (sample) => sample.distanceM > startDistanceM && sample.distanceM < endDistanceM,
      ),
      interpolateSampleAtDistance(profile.samples, endDistanceM),
    ];
    const splitProfile: RouteConditionsProfile = {
      ...profile,
      startTime: samples[0].time,
      finishTime: samples.at(-1)!.time,
      durationSeconds: (samples.at(-1)!.time - samples[0].time) / 1000,
      radiationDoseJm2: 0,
      samples,
    };
    const summary = presentRouteConditionsProfile(splitProfile);
    const canopySummary = splitCanopySummary(samples);
    const durationSeconds = splitProfile.durationSeconds;
    const meanHeadwindMs = summary.wind.meanHeadwindMs;
    const meanWindSpeedMs = timeWeightedMean(samples, (sample) => sample.ambientWindSpeedMs);
    const windClass = classifyRouteWind({
      ambientWindSpeedMs: meanWindSpeedMs,
      ambientHeadwindMs: meanHeadwindMs,
    });
    splits.push({
      index: splits.length + 1,
      startDistanceM,
      endDistanceM,
      startTime: splitProfile.startTime,
      endTime: splitProfile.finishTime,
      durationSeconds,
      speedMs: (endDistanceM - startDistanceM) / durationSeconds,
      meanAirTemperatureC: timeWeightedMean(samples, (sample) => sample.airTemperatureC),
      meanFeelsLikeC: timeWeightedMean(samples, (sample) => sample.feelsLikeC),
      meanSunlightIntensityWm2: summary.forecastSunlight.meanIntensityWm2,
      forecastSunlightLevel: summary.forecastSunlight.level,
      woodlandEvidenceFraction: splitWoodlandFraction(profile, samples),
      meanCanopyPct: canopySummary.meanCanopyPct,
      meanBlockedDirectFraction: canopySummary.meanBlockedDirectFraction,
      canopyAvailableFraction: canopySummary.availableFraction,
      windClass,
      meanHeadwindMs,
      meanCrosswindMs: summary.wind.meanCrosswindMs,
      crosswindSide: summary.wind.crosswindSide,
      peakGustMs: summary.wind.peakGustMs,
    });
  }
  return splits;
}
