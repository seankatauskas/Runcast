import type {
  ConditionsSuitabilityAssessment,
  PhysicalExposureSummary,
  EvaluatedRun,
} from './types';

export type ConditionsImpactLevel = 'minimal' | 'low' | 'moderate' | 'high';
export type SunExposureLevel = 'none' | ConditionsImpactLevel;
export type SunlightIntensityLevel = SunExposureLevel;
export type WindEffectLevel =
  'little-resistance' | 'light-resistance' | 'moderate-resistance' | 'strong-resistance';

export type ConditionsFactorKey =
  'temperature' | 'radiation' | 'aerodynamicOpposition' | 'precipitation';

export interface ConditionsFactorPresentation {
  key: ConditionsFactorKey;
  label: string;
  impact: ConditionsImpactLevel;
  penaltyPoints: number;
}

export interface RunConditionsPresentation {
  overallLabel: 'Favorable' | 'Mixed' | 'Challenging';
  planningIndex: number;
  dominantFactorStory: string;
  sunExposure: {
    level: SunExposureLevel;
    label: 'None' | 'Minimal' | 'Low' | 'Moderate' | 'High';
    doseKJm2: number;
    meanIntensityWm2: number;
  };
  windEffect: {
    level: WindEffectLevel;
    headline: 'Little' | 'Light' | 'Moderate' | 'Strong';
    label: 'Little resistance' | 'Light resistance' | 'Moderate resistance' | 'Strong resistance';
    apparentAirflowMs: number;
  };
  factors: ConditionsFactorPresentation[];
}

const FACTOR_ORDER: ConditionsFactorKey[] = [
  'temperature',
  'radiation',
  'aerodynamicOpposition',
  'precipitation',
];

const FACTOR_LABELS: Record<ConditionsFactorKey, string> = {
  temperature: 'Temperature',
  radiation: 'Sun and warmth',
  aerodynamicOpposition: 'Wind resistance',
  precipitation: 'Rain',
};

const FACTOR_STORIES: Record<ConditionsFactorKey, string> = {
  temperature: 'Air temperature is the main tradeoff',
  radiation: 'Sun and warmth are the main tradeoff',
  aerodynamicOpposition: 'Wind resistance is the main tradeoff',
  precipitation: 'Rain is the main tradeoff',
};

const SUN_LABELS: Record<SunExposureLevel, RunConditionsPresentation['sunExposure']['label']> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

const WIND_LABELS: Record<WindEffectLevel, RunConditionsPresentation['windEffect']['label']> = {
  'little-resistance': 'Little resistance',
  'light-resistance': 'Light resistance',
  'moderate-resistance': 'Moderate resistance',
  'strong-resistance': 'Strong resistance',
};

const WIND_HEADLINES: Record<WindEffectLevel, RunConditionsPresentation['windEffect']['headline']> =
  {
    'little-resistance': 'Little',
    'light-resistance': 'Light',
    'moderate-resistance': 'Moderate',
    'strong-resistance': 'Strong',
  };

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

export function sunExposureLevel(doseJm2: number): SunExposureLevel {
  requireFinite(doseJm2, 'doseJm2');
  if (doseJm2 < 0) throw new TypeError('doseJm2 must be nonnegative');
  if (doseJm2 === 0) return 'none';
  const doseKJm2 = doseJm2 / 1000;
  if (doseKJm2 < 100) return 'minimal';
  if (doseKJm2 < 500) return 'low';
  if (doseKJm2 < 1500) return 'moderate';
  return 'high';
}

/**
 * Point-in-time radiation bands for route visualizations, separate from whole-run dose.
 * Solar geometry owns the night/day distinction because coarse hourly forecast buckets can
 * remain zero briefly after sunrise.
 */
export function sunlightIntensityLevel(
  radiationWm2: number,
  daylight = true,
): SunlightIntensityLevel {
  requireFinite(radiationWm2, 'radiationWm2');
  if (radiationWm2 < 0) throw new TypeError('radiationWm2 must be nonnegative');
  if (!daylight) return 'none';
  if (radiationWm2 < 50) return 'minimal';
  if (radiationWm2 < 200) return 'low';
  if (radiationWm2 < 600) return 'moderate';
  return 'high';
}

export function windEffectLevel(aerodynamicOppositionFactor: number): WindEffectLevel {
  requireFinite(aerodynamicOppositionFactor, 'aerodynamicOppositionFactor');
  if (aerodynamicOppositionFactor < 0.02) return 'little-resistance';
  if (aerodynamicOppositionFactor < 0.08) return 'light-resistance';
  if (aerodynamicOppositionFactor < 0.14) return 'moderate-resistance';
  return 'strong-resistance';
}

export function conditionsImpactLevel(penalty: number): ConditionsImpactLevel {
  requireFinite(penalty, 'penalty');
  if (penalty < 0.02) return 'minimal';
  if (penalty < 0.08) return 'low';
  if (penalty < 0.15) return 'moderate';
  return 'high';
}

function factorValue(fit: ConditionsSuitabilityAssessment, key: ConditionsFactorKey): number {
  const value = fit.factors[key] ?? 0;
  requireFinite(value, `conditionsFit.factors.${key}`);
  return Math.max(value, 0);
}

export function presentRunConditions(
  plan: Pick<
    EvaluatedRun,
    'durationSeconds' | 'physicalConditions' | 'exposureSummary' | 'conditionsFit'
  >,
): RunConditionsPresentation {
  requireFinite(plan.durationSeconds, 'durationSeconds');
  if (plan.durationSeconds <= 0) throw new TypeError('durationSeconds must be positive');
  const physical: PhysicalExposureSummary = plan.physicalConditions;
  requireFinite(physical.radiationDoseJm2, 'physicalConditions.radiationDoseJm2');
  requireFinite(physical.meanApparentAirflowMs, 'physicalConditions.meanApparentAirflowMs');
  requireFinite(plan.conditionsFit.value, 'conditionsFit.value');

  const factors = FACTOR_ORDER.map((key) => {
    const value = factorValue(plan.conditionsFit, key);
    return {
      key,
      label: FACTOR_LABELS[key],
      impact: conditionsImpactLevel(value),
      penaltyPoints: Math.round(value * 100),
    };
  });
  const dominant = factors.reduce((highest, factor) =>
    factor.penaltyPoints > highest.penaltyPoints ? factor : highest,
  );
  const sunLevel =
    plan.exposureSummary.daylightFraction === 0
      ? 'none'
      : sunExposureLevel(physical.radiationDoseJm2);
  const windLevel = windEffectLevel(factorValue(plan.conditionsFit, 'aerodynamicOpposition'));

  return {
    overallLabel:
      plan.conditionsFit.label === 'favorable'
        ? 'Favorable'
        : plan.conditionsFit.label === 'mixed'
          ? 'Mixed'
          : 'Challenging',
    planningIndex: Math.round(Math.min(Math.max(plan.conditionsFit.value, 0), 1) * 100),
    dominantFactorStory:
      dominant.penaltyPoints >= 2 ? FACTOR_STORIES[dominant.key] : 'No major forecast tradeoffs',
    sunExposure: {
      level: sunLevel,
      label: SUN_LABELS[sunLevel],
      doseKJm2: physical.radiationDoseJm2 / 1000,
      meanIntensityWm2: physical.radiationDoseJm2 / plan.durationSeconds,
    },
    windEffect: {
      level: windLevel,
      headline: WIND_HEADLINES[windLevel],
      label: WIND_LABELS[windLevel],
      apparentAirflowMs: physical.meanApparentAirflowMs,
    },
    factors,
  };
}
