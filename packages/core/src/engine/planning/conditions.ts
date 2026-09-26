import type {
  ConditionsSuitabilityAssessment,
  PhysicalExposureSummary,
  SafetyAssessment,
} from './types';
import { CONDITIONS_SUITABILITY_MODEL_VERSION, SAFETY_POLICY_VERSION } from './versions';

export const HEAVY_RAIN_RATE_MM_H = 7;
export const EXTREME_HEAT_C = 35;
export const HIGH_GUST_MS = 17;
const THUNDER_CODES = new Set([95, 96, 99]);
const HEAVY_RAIN_CODES = new Set([65, 67, 82]);

export interface TimedConditionSample {
  time: number;
  airTemperatureC: number | null;
  feelsLikeC: number | null;
  radiationWm2: number | null;
  directNormalRadiationWm2: number | null;
  diffuseRadiationWm2: number | null;
  precipitationProbabilityPct: number | null;
  precipitationRateMmH: number | null;
  gustMs: number | null;
  weatherCode: number | null;
  apparentAirflowMs: number | null;
  aerodynamicOpposition: number | null;
}

export type SafetyAssessmentResult =
  | { status: 'evaluable'; assessment: SafetyAssessment }
  | { status: 'unevaluable'; reasons: string[] };

export type PhysicalExposureResult =
  | { status: 'ok'; exposure: PhysicalExposureSummary }
  | { status: 'unevaluable'; reasons: string[] };

export type ConditionsSuitabilityResult =
  | { status: 'ok'; assessment: ConditionsSuitabilityAssessment }
  | { status: 'unevaluable'; reasons: string[] };

const requiredRanges = {
  airTemperatureC: [-90, 65],
  feelsLikeC: [-100, 80],
  radiationWm2: [0, 2000],
  directNormalRadiationWm2: [0, 2000],
  diffuseRadiationWm2: [0, 2000],
  precipitationProbabilityPct: [0, 100],
  precipitationRateMmH: [0, 500],
  gustMs: [0, 150],
  weatherCode: [0, 99],
  apparentAirflowMs: [0, 200],
  aerodynamicOpposition: [-100_000, 100_000],
} as const;

function validationReasons(samples: readonly TimedConditionSample[]): string[] {
  const reasons: string[] = [];
  if (samples.length < 2) reasons.push('conditions.insufficient-timed-samples');
  for (let index = 0; index < samples.length; index += 1) {
    if (
      !Number.isFinite(samples[index].time) ||
      (index > 0 && samples[index].time <= samples[index - 1].time)
    ) {
      reasons.push('conditions.invalid-time-order');
      break;
    }
    for (const [key, range] of Object.entries(requiredRanges) as Array<
      [keyof typeof requiredRanges, readonly [number, number]]
    >) {
      const value = samples[index][key];
      if (value === null || !Number.isFinite(value)) {
        reasons.push(`conditions.missing-required:${key}`);
      } else if (value < range[0] || value > range[1]) {
        reasons.push(`conditions.out-of-range:${key}`);
      }
    }
  }
  return [...new Set(reasons)];
}

export function assessSafety(samples: readonly TimedConditionSample[]): SafetyAssessmentResult {
  const invalid = validationReasons(samples);
  if (invalid.length) return { status: 'unevaluable', reasons: invalid };
  const reasons: string[] = [];
  if (samples.some((sample) => THUNDER_CODES.has(sample.weatherCode!))) {
    reasons.push('safety.thunderstorm');
  }
  if (
    samples.some(
      (sample) =>
        HEAVY_RAIN_CODES.has(sample.weatherCode!) ||
        sample.precipitationRateMmH! >= HEAVY_RAIN_RATE_MM_H,
    )
  ) {
    reasons.push('safety.heavy-rain');
  }
  if (samples.some((sample) => sample.feelsLikeC! >= EXTREME_HEAT_C)) {
    reasons.push('safety.extreme-heat');
  }
  if (samples.some((sample) => sample.gustMs! >= HIGH_GUST_MS)) {
    reasons.push('safety.high-wind');
  }
  return {
    status: 'evaluable',
    assessment: {
      tier: reasons.includes('safety.thunderstorm')
        ? 'ineligible'
        : reasons.length
          ? 'caution'
          : 'eligible',
      policyVersion: SAFETY_POLICY_VERSION,
      reasons,
    },
  };
}

function integrateMean(
  samples: readonly TimedConditionSample[],
  pick: (sample: TimedConditionSample) => number,
): number {
  let integral = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const elapsedSeconds = (samples[index].time - samples[index - 1].time) / 1000;
    integral += ((pick(samples[index - 1]) + pick(samples[index])) / 2) * elapsedSeconds;
  }
  const durationSeconds = (samples.at(-1)!.time - samples[0].time) / 1000;
  return integral / durationSeconds;
}

export function summarizePhysicalExposure(
  samples: readonly TimedConditionSample[],
): PhysicalExposureResult {
  const invalid = validationReasons(samples);
  if (invalid.length) return { status: 'unevaluable', reasons: invalid };
  const durationSeconds = (samples.at(-1)!.time - samples[0].time) / 1000;
  return {
    status: 'ok',
    exposure: {
      meanTemperatureC: integrateMean(samples, (sample) => sample.airTemperatureC!),
      radiationDoseJm2: integrateMean(samples, (sample) => sample.radiationWm2!) * durationSeconds,
      directNormalRadiationDoseJm2:
        integrateMean(samples, (sample) => sample.directNormalRadiationWm2!) * durationSeconds,
      diffuseRadiationDoseJm2:
        integrateMean(samples, (sample) => sample.diffuseRadiationWm2!) * durationSeconds,
      precipitationAmountMm:
        (integrateMean(samples, (sample) => sample.precipitationRateMmH!) * durationSeconds) / 3600,
      meanApparentAirflowMs: integrateMean(samples, (sample) => sample.apparentAirflowMs!),
      meanAerodynamicOpposition: integrateMean(samples, (sample) => sample.aerodynamicOpposition!),
      peaks: {
        feelsLikeC: Math.max(...samples.map((sample) => sample.feelsLikeC!)),
        gustMs: Math.max(...samples.map((sample) => sample.gustMs!)),
        precipitationRateMmH: Math.max(...samples.map((sample) => sample.precipitationRateMmH!)),
        precipitationProbabilityPct: Math.max(
          ...samples.map((sample) => sample.precipitationProbabilityPct!),
        ),
      },
    },
  };
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

const IDEAL_RUNNING_TEMPERATURE_C = 11;
const COLD_TEMPERATURE_RANGE_C = 18;
const WARM_TEMPERATURE_RANGE_C = 23;

function temperatureFitPenalty(airTemperatureC: number): number {
  const distanceFromIdeal = airTemperatureC - IDEAL_RUNNING_TEMPERATURE_C;
  const range = distanceFromIdeal >= 0 ? WARM_TEMPERATURE_RANGE_C : COLD_TEMPERATURE_RANGE_C;
  return clamp01((distanceFromIdeal / range) ** 2);
}

function fitFactors(sample: TimedConditionSample): Record<string, number> {
  const temperature = temperatureFitPenalty(sample.airTemperatureC!);
  const radiation =
    0.25 * clamp01(sample.radiationWm2! / 800) * clamp01((sample.airTemperatureC! - 18) / 10);
  const aerodynamicOpposition = 0.2 * clamp01(sample.aerodynamicOpposition! / 64);
  const rainIntensity = 0.4 + 0.6 * clamp01(sample.precipitationRateMmH! / 5);
  const precipitation = 0.3 * clamp01(sample.precipitationProbabilityPct! / 100) * rainIntensity;
  return { temperature, radiation, aerodynamicOpposition, precipitation };
}

export function assessConditionsSuitability(
  samples: readonly TimedConditionSample[],
): ConditionsSuitabilityResult {
  const invalid = validationReasons(samples);
  if (invalid.length) return { status: 'unevaluable', reasons: invalid };
  const factors = {
    temperature: integrateMean(samples, (sample) => fitFactors(sample).temperature),
    radiation: integrateMean(samples, (sample) => fitFactors(sample).radiation),
    aerodynamicOpposition: integrateMean(
      samples,
      (sample) => fitFactors(sample).aerodynamicOpposition,
    ),
    precipitation: integrateMean(samples, (sample) => fitFactors(sample).precipitation),
  };
  const value = clamp01(1 - Object.values(factors).reduce((sum, factor) => sum + factor, 0));
  return {
    status: 'ok',
    assessment: {
      value,
      label: value >= 0.75 ? 'favorable' : value >= 0.45 ? 'mixed' : 'challenging',
      version: CONDITIONS_SUITABILITY_MODEL_VERSION,
      factors,
    },
  };
}
