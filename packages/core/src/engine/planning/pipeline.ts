import { assessSafety, summarizePhysicalExposure, assessConditionsSuitability } from './conditions';
import { contentIdentity } from './identity';
import { solarPosition } from './solar';
import { buildRouteTiming } from './timing';
import type {
  WoodlandEvidenceProfile,
  NormalizedRouteForecast,
  PhysicalExposureSummary,
  PlanningRoute,
  ReasonCode,
  WoodlandEvidenceValue,
} from './types';
import { sampleRouteForecast } from './weather';
import { runnerRelativeWind } from './wind';
import type { TimedConditionSample } from './conditions';
import type { SolarPosition } from './solar';
import type { RouteTiming } from './timing';
import { adjustRadiationForCanopy, canopyEvidenceAt, selectedRadiation } from './canopy';
import type {
  CanopyEvidenceProfile,
  CanopyModelMode,
  CanopyPhysicalExposureSummary,
  StartCandidateAssessmentV3,
} from './types';

export interface EvaluateRunInput {
  route: PlanningRoute;
  forecast: NormalizedRouteForecast;
  woodlandEvidence: WoodlandEvidenceProfile;
  startTime: number;
  expectedFlatSpeedMs: number;
  canopyEvidence?: CanopyEvidenceProfile;
  canopyModelMode?: CanopyModelMode;
}

export interface RouteConditionsSample {
  distanceM: number;
  time: number;
  daylight: boolean;
  elevationM: number | null;
  woodlandEvidence: WoodlandEvidenceValue;
  canopyPct?: number | null;
  standardErrorPct?: number | null;
  blockedDirectFraction?: number;
  openSkyRadiationWm2?: number;
  canopyAdjustedRadiationWm2?: number;
  airTemperatureC: number;
  feelsLikeC: number;
  radiationWm2: number;
  directNormalRadiationWm2: number;
  diffuseRadiationWm2: number;
  precipitationProbabilityPct: number;
  precipitationRateMmH: number;
  gustMs: number;
  ambientWindSpeedMs: number;
  ambientWindDirectionFromDeg?: number;
  /** Positive opposes travel (headwind); negative assists travel (tailwind). */
  ambientHeadwindMs: number;
  /** Positive comes from the runner's left; negative comes from the right. */
  ambientCrosswindMs: number;
  apparentAirflowMs: number;
  apparentCrossTrackMs: number;
  aerodynamicOppositionDelta: number;
}

export interface RouteConditionsProfile {
  schemaVersion: 2;
  startTime: number;
  finishTime: number;
  durationSeconds: number;
  radiationDoseJm2: number;
  openSkyRadiationDoseJm2?: number;
  canopyAdjustedRadiationDoseJm2?: number;
  woodland: {
    mappedFraction: number | null;
    completeness: WoodlandEvidenceProfile['completeness'];
    confidence: number | null;
  };
  canopy?: {
    availableFraction: number;
    meanCanopyPct: number | null;
    meanBlockedDirectFraction: number;
    completeness: CanopyEvidenceProfile['completeness'];
    modelMode: CanopyModelMode;
  };
  samples: RouteConditionsSample[];
}

export type RouteConditionsProfileResult =
  | { status: 'ok'; profile: RouteConditionsProfile }
  | { status: 'unevaluable'; finishTime: number; reasons: ReasonCode[] };

interface RouteConditionsDraftSample {
  distanceM: number;
  time: number;
  daylight: boolean;
  elevationM: number | null;
  woodlandEvidence: WoodlandEvidenceValue;
  canopyPct: number | null;
  standardErrorPct: number | null;
  blockedDirectFraction: number;
  openSkyRadiationWm2: number | null;
  canopyAdjustedRadiationWm2: number | null;
  airTemperatureC: number | null;
  feelsLikeC: number | null;
  radiationWm2: number | null;
  directNormalRadiationWm2: number | null;
  diffuseRadiationWm2: number | null;
  precipitationProbabilityPct: number | null;
  precipitationRateMmH: number | null;
  gustMs: number | null;
  ambientWindSpeedMs: number;
  ambientWindDirectionFromDeg?: number;
  ambientHeadwindMs: number;
  ambientCrosswindMs: number;
  apparentAirflowMs: number;
  apparentCrossTrackMs: number;
  aerodynamicOppositionDelta: number;
}

type PreparedRouteConditions =
  | {
      status: 'ok';
      timing: RouteTiming;
      conditionSamples: TimedConditionSample[];
      openSkyConditionSamples: TimedConditionSample[];
      canopyAdjustedConditionSamples: TimedConditionSample[];
      solar: SolarPosition[];
      physicalExposure: PhysicalExposureSummary;
      openSkyPhysicalExposure: PhysicalExposureSummary;
      canopyAdjustedPhysicalExposure: PhysicalExposureSummary;
      profile: RouteConditionsProfile;
    }
  | { status: 'unevaluable'; timing: RouteTiming; reasons: ReasonCode[] };

function precipitationRateMmH(
  field: NormalizedRouteForecast,
  routeDistanceM: number,
  at: number,
  intervalAmountMm: number,
): number {
  const anchor = field.anchors.reduce((closest, candidate) =>
    Math.abs(candidate.routeDistanceM - routeDistanceM) <
    Math.abs(closest.routeDistanceM - routeDistanceM)
      ? candidate
      : closest,
  );
  const times = anchor.hourly.time;
  let index = times.findIndex((time) => time > at) - 1;
  if (index < 0) index = at >= times.at(-1)! ? times.length - 1 : 0;
  const lower = Math.min(index, times.length - 2);
  const hours = (times[lower + 1] - times[lower]) / 3_600_000;
  return hours > 0 ? intervalAmountMm / hours : Number.NaN;
}

function intervalWeightedFraction(times: readonly number[], values: readonly boolean[]): number {
  let trueSeconds = 0;
  let totalSeconds = 0;
  for (let index = 1; index < times.length; index += 1) {
    const duration = (times[index] - times[index - 1]) / 1000;
    trueSeconds += ((Number(values[index - 1]) + Number(values[index])) / 2) * duration;
    totalSeconds += duration;
  }
  return totalSeconds > 0 ? trueSeconds / totalSeconds : Number(values[0] ?? false);
}

function intervalWeightedMean(times: readonly number[], values: readonly number[]): number {
  let integral = 0;
  let totalSeconds = 0;
  for (let index = 1; index < times.length; index += 1) {
    const duration = (times[index] - times[index - 1]) / 1000;
    integral += ((values[index - 1] + values[index]) / 2) * duration;
    totalSeconds += duration;
  }
  return totalSeconds > 0 ? integral / totalSeconds : (values[0] ?? 0);
}

function woodlandEvidenceAt(
  woodlandEvidence: WoodlandEvidenceProfile,
  distanceM: number,
): WoodlandEvidenceValue {
  if (!woodlandEvidence.values.length || woodlandEvidence.resolutionM <= 0) return 'unknown';
  const index = Math.min(
    Math.round(distanceM / woodlandEvidence.resolutionM),
    woodlandEvidence.values.length - 1,
  );
  return woodlandEvidence.values[index] ?? 'unknown';
}

function mappedWoodlandFraction(woodlandEvidence: WoodlandEvidenceProfile): number | null {
  return woodlandEvidence.completeness === 'complete' &&
    woodlandEvidence.values.length > 0 &&
    woodlandEvidence.values.every((value) => value !== 'unknown')
    ? woodlandEvidence.values.filter((value) => value === 'mapped-woodland').length /
        woodlandEvidence.values.length
    : null;
}

function prepareRouteConditions(input: EvaluateRunInput): PreparedRouteConditions {
  const timing = buildRouteTiming(input.route, input.startTime, input.expectedFlatSpeedMs);
  const conditionSamples: TimedConditionSample[] = [];
  const openSkyConditionSamples: TimedConditionSample[] = [];
  const canopyAdjustedConditionSamples: TimedConditionSample[] = [];
  const draftSamples: RouteConditionsDraftSample[] = [];
  const solar: SolarPosition[] = [];
  const unavailable: ReasonCode[] = [];
  for (const point of timing.points) {
    const sampled = sampleRouteForecast(input.forecast, point.distanceM, point.time);
    if (sampled.status === 'unevaluable') {
      unavailable.push(...sampled.reasons);
      continue;
    }
    const values = sampled.sample.values;
    if (
      values.windSpeedMs === null ||
      values.windDirectionFromDeg === null ||
      values.precipitationMm === null
    ) {
      unavailable.push('recommendation.input-unavailable');
      continue;
    }
    const wind = runnerRelativeWind({
      ambientSpeedMs: values.windSpeedMs,
      meteorologicalFromDeg: values.windDirectionFromDeg,
      runnerBearingDeg: point.bearingDeg,
      runnerSpeedMs: point.speedMs,
    });
    const precipitationRate = precipitationRateMmH(
      input.forecast,
      point.distanceM,
      point.time,
      values.precipitationMm,
    );
    const sun = solarPosition(point.time, point.position.lat, point.position.lon);
    if (
      values.shortwaveRadiationWm2 === null ||
      values.directNormalRadiationWm2 === null ||
      values.diffuseRadiationWm2 === null
    ) {
      unavailable.push('recommendation.input-unavailable');
      continue;
    }
    const canopy = input.canopyEvidence
      ? canopyEvidenceAt(input.canopyEvidence, point.distanceM)
      : { canopyPct: null, standardErrorPct: null };
    const radiation = adjustRadiationForCanopy({
      shortwaveWm2: values.shortwaveRadiationWm2,
      directNormalWm2: values.directNormalRadiationWm2,
      diffuseWm2: values.diffuseRadiationWm2,
      ...canopy,
      latitude: point.position.lat,
      at: point.time,
    });
    const modelMode = input.canopyModelMode ?? 'off';
    const selected = selectedRadiation(radiation, modelMode);
    const commonConditions = {
      time: point.time,
      airTemperatureC: values.temperatureC,
      feelsLikeC: values.feelsLikeC,
      diffuseRadiationWm2: values.diffuseRadiationWm2,
      precipitationProbabilityPct: values.precipitationProbabilityPct,
      precipitationRateMmH: precipitationRate,
      gustMs: values.gustMs,
      weatherCode: values.weatherCode,
      apparentAirflowMs: wind.apparentAirflow.speedMs,
      aerodynamicOpposition: wind.aerodynamicOppositionDelta,
    };
    conditionSamples.push({
      ...commonConditions,
      radiationWm2: selected.shortwaveWm2,
      directNormalRadiationWm2: selected.directNormalWm2,
    });
    openSkyConditionSamples.push({
      ...commonConditions,
      radiationWm2: radiation.openSkyShortwaveWm2,
      directNormalRadiationWm2: radiation.openSkyDirectNormalWm2,
    });
    canopyAdjustedConditionSamples.push({
      ...commonConditions,
      radiationWm2: radiation.adjustedShortwaveWm2,
      directNormalRadiationWm2: radiation.adjustedDirectNormalWm2,
    });
    draftSamples.push({
      distanceM: point.distanceM,
      time: point.time,
      daylight: sun.daylight,
      elevationM: point.position.elevationM,
      woodlandEvidence: woodlandEvidenceAt(input.woodlandEvidence, point.distanceM),
      canopyPct: canopy.canopyPct,
      standardErrorPct: canopy.standardErrorPct,
      blockedDirectFraction: radiation.blockedDirectFraction,
      openSkyRadiationWm2: radiation.openSkyShortwaveWm2,
      canopyAdjustedRadiationWm2: radiation.adjustedShortwaveWm2,
      airTemperatureC: values.temperatureC,
      feelsLikeC: values.feelsLikeC,
      radiationWm2: selected.shortwaveWm2,
      directNormalRadiationWm2: selected.directNormalWm2,
      diffuseRadiationWm2: values.diffuseRadiationWm2,
      precipitationProbabilityPct: values.precipitationProbabilityPct,
      precipitationRateMmH: precipitationRate,
      gustMs: values.gustMs,
      ambientWindSpeedMs: wind.ambient.speedMs,
      ambientWindDirectionFromDeg: values.windDirectionFromDeg,
      ambientHeadwindMs: wind.ambient.alongTrackMs,
      ambientCrosswindMs: wind.ambient.crossTrackMs,
      apparentAirflowMs: wind.apparentAirflow.speedMs,
      apparentCrossTrackMs: wind.apparentAirflow.crossTrackMs,
      aerodynamicOppositionDelta: wind.aerodynamicOppositionDelta,
    });
    solar.push(sun);
  }
  if (unavailable.length || conditionSamples.length !== timing.points.length) {
    return {
      status: 'unevaluable',
      timing,
      reasons: [...new Set([...timing.reasons, ...unavailable])],
    };
  }
  const physicalExposure = summarizePhysicalExposure(conditionSamples);
  const openSkyPhysicalExposure = summarizePhysicalExposure(openSkyConditionSamples);
  const canopyAdjustedPhysicalExposure = summarizePhysicalExposure(canopyAdjustedConditionSamples);
  if (
    physicalExposure.status === 'unevaluable' ||
    openSkyPhysicalExposure.status === 'unevaluable' ||
    canopyAdjustedPhysicalExposure.status === 'unevaluable'
  ) {
    return {
      status: 'unevaluable',
      timing,
      reasons: [
        ...new Set([
          ...timing.reasons,
          ...(physicalExposure.status === 'unevaluable' ? physicalExposure.reasons : []),
          ...(openSkyPhysicalExposure.status === 'unevaluable'
            ? openSkyPhysicalExposure.reasons
            : []),
          ...(canopyAdjustedPhysicalExposure.status === 'unevaluable'
            ? canopyAdjustedPhysicalExposure.reasons
            : []),
        ]),
      ],
    };
  }
  const sampleTimes = conditionSamples.map((sample) => sample.time);
  const available = draftSamples.map(
    (sample) => sample.canopyPct !== null && sample.standardErrorPct !== null,
  );
  const availableCanopyValues = draftSamples.flatMap((sample) =>
    sample.canopyPct === null ? [] : [sample.canopyPct],
  );
  const canopySummary = {
    availableFraction: intervalWeightedFraction(sampleTimes, available),
    meanCanopyPct: availableCanopyValues.length
      ? availableCanopyValues.reduce((sum, value) => sum + value, 0) / availableCanopyValues.length
      : null,
    meanBlockedDirectFraction: intervalWeightedMean(
      sampleTimes,
      draftSamples.map((sample) => sample.blockedDirectFraction),
    ),
    completeness: input.canopyEvidence?.completeness ?? ('unavailable' as const),
    modelMode: input.canopyModelMode ?? ('off' as const),
  };
  return {
    status: 'ok',
    timing,
    conditionSamples,
    openSkyConditionSamples,
    canopyAdjustedConditionSamples,
    solar,
    physicalExposure: physicalExposure.exposure,
    openSkyPhysicalExposure: openSkyPhysicalExposure.exposure,
    canopyAdjustedPhysicalExposure: canopyAdjustedPhysicalExposure.exposure,
    profile: {
      schemaVersion: 2,
      startTime: input.startTime,
      finishTime: timing.finishTime,
      durationSeconds: timing.durationSeconds,
      radiationDoseJm2: physicalExposure.exposure.radiationDoseJm2,
      openSkyRadiationDoseJm2: openSkyPhysicalExposure.exposure.radiationDoseJm2,
      canopyAdjustedRadiationDoseJm2: canopyAdjustedPhysicalExposure.exposure.radiationDoseJm2,
      woodland: {
        mappedFraction: mappedWoodlandFraction(input.woodlandEvidence),
        completeness: input.woodlandEvidence.completeness,
        confidence: input.woodlandEvidence.confidence,
      },
      canopy: canopySummary,
      samples: draftSamples.map((sample) => ({
        ...sample,
        openSkyRadiationWm2: sample.openSkyRadiationWm2!,
        canopyAdjustedRadiationWm2: sample.canopyAdjustedRadiationWm2!,
        airTemperatureC: sample.airTemperatureC!,
        feelsLikeC: sample.feelsLikeC!,
        radiationWm2: sample.radiationWm2!,
        directNormalRadiationWm2: sample.directNormalRadiationWm2!,
        diffuseRadiationWm2: sample.diffuseRadiationWm2!,
        precipitationProbabilityPct: sample.precipitationProbabilityPct!,
        precipitationRateMmH: sample.precipitationRateMmH!,
        gustMs: sample.gustMs!,
      })),
    },
  };
}

/** Route-distance visualization samples from the evaluator's exact preparation path. */
export function buildRouteConditionsProfile(input: EvaluateRunInput): RouteConditionsProfileResult {
  const prepared = prepareRouteConditions(input);
  return prepared.status === 'ok'
    ? { status: 'ok', profile: prepared.profile }
    : {
        status: 'unevaluable',
        finishTime: prepared.timing.finishTime,
        reasons: prepared.reasons,
      };
}

/** V3 evaluator exposing both open-sky and canopy-adjusted radiation doses. */
export function evaluateRunV3(input: EvaluateRunInput): StartCandidateAssessmentV3 {
  return assessPreparedRunV3(input, prepareRouteConditions(input));
}

/** Selected-run assessment and display share the same weather/timing preparation. */
export function evaluateRunWithProfile(input: EvaluateRunInput): {
  assessment: StartCandidateAssessmentV3;
  profile: RouteConditionsProfile | null;
} {
  const prepared = prepareRouteConditions(input);
  return {
    assessment: assessPreparedRunV3(input, prepared),
    profile: prepared.status === 'ok' ? prepared.profile : null,
  };
}

function assessPreparedRunV3(
  input: EvaluateRunInput,
  prepared: PreparedRouteConditions,
): StartCandidateAssessmentV3 {
  if (prepared.status === 'unevaluable') {
    return {
      startTime: input.startTime,
      finishTime: prepared.timing.finishTime,
      evaluable: false,
      safety: null,
      conditionsFit: null,
      plan: null,
      reasons: prepared.reasons,
    };
  }
  const { timing, conditionSamples: samples, solar } = prepared;
  const safety = assessSafety(samples);
  const conditionsSuitability = assessConditionsSuitability(samples);
  if (safety.status !== 'evaluable' || conditionsSuitability.status !== 'ok') {
    const reasons = [
      ...(safety.status === 'unevaluable' ? safety.reasons : []),
      ...(conditionsSuitability.status === 'unevaluable' ? conditionsSuitability.reasons : []),
    ];
    return {
      startTime: input.startTime,
      finishTime: timing.finishTime,
      evaluable: false,
      safety: null,
      conditionsFit: null,
      plan: null,
      reasons: [...new Set([...timing.reasons, ...reasons])],
    };
  }
  const canopy = prepared.profile.canopy!;
  const selected = prepared.physicalExposure;
  const physicalConditions: CanopyPhysicalExposureSummary = {
    ...selected,
    openSkyRadiationDoseJm2: prepared.openSkyPhysicalExposure.radiationDoseJm2,
    canopyAdjustedRadiationDoseJm2: prepared.canopyAdjustedPhysicalExposure.radiationDoseJm2,
    openSkyDirectNormalRadiationDoseJm2:
      prepared.openSkyPhysicalExposure.directNormalRadiationDoseJm2,
    canopyAdjustedDirectNormalRadiationDoseJm2:
      prepared.canopyAdjustedPhysicalExposure.directNormalRadiationDoseJm2,
  };
  const reasons = [
    ...timing.reasons,
    ...input.woodlandEvidence.reasons,
    ...(input.canopyEvidence?.reasons ?? ['canopy.unavailable']),
    ...safety.assessment.reasons,
  ].filter((reason, index, all) => all.indexOf(reason) === index);
  const planBody = {
    schemaVersion: 3 as const,
    routeId: input.route.id,
    startTime: input.startTime,
    finishTime: timing.finishTime,
    durationSeconds: timing.durationSeconds,
    timingQuality: timing.quality,
    paceModelVersion: timing.paceModelVersion,
    canopyModelMode: input.canopyModelMode ?? ('off' as const),
    safety: safety.assessment,
    physicalConditions,
    exposureSummary: {
      geometricSolarElevationDeg: {
        minimum: Math.min(...solar.map((position) => position.geometricElevationDeg)),
        maximum: Math.max(...solar.map((position) => position.geometricElevationDeg)),
      },
      apparentSolarElevationDeg: {
        minimum: Math.min(...solar.map((position) => position.apparentElevationDeg)),
        maximum: Math.max(...solar.map((position) => position.apparentElevationDeg)),
      },
      daylightFraction: intervalWeightedFraction(
        samples.map((sample) => sample.time),
        solar.map((position) => position.daylight),
      ),
      mappedWoodlandFraction: mappedWoodlandFraction(input.woodlandEvidence),
      coverageCompleteness: input.woodlandEvidence.completeness,
      canopyAvailableFraction: canopy.availableFraction,
      meanCanopyPct: canopy.meanCanopyPct,
      meanBlockedDirectFraction: canopy.meanBlockedDirectFraction,
      canopyCompleteness: canopy.completeness,
    },
    conditionsFit: conditionsSuitability.assessment,
    reasons,
  };
  const plan = { ...planBody, evaluationId: contentIdentity(planBody) };
  return {
    startTime: input.startTime,
    finishTime: timing.finishTime,
    evaluable: true,
    safety: safety.assessment,
    conditionsFit: conditionsSuitability.assessment.value,
    plan,
    reasons,
  };
}
