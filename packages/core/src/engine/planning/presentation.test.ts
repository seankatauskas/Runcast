import { describe, expect, it } from 'vitest';
import type { ConditionsSuitabilityAssessment, PhysicalExposureSummary } from './types';
import {
  conditionsImpactLevel,
  presentRunConditions,
  sunExposureLevel,
  sunlightIntensityLevel,
  windEffectLevel,
} from './presentation';

const physicalConditions: PhysicalExposureSummary = {
  meanTemperatureC: 22,
  radiationDoseJm2: 1_080_000,
  directNormalRadiationDoseJm2: 700_000,
  diffuseRadiationDoseJm2: 380_000,
  precipitationAmountMm: 0,
  meanApparentAirflowMs: 4,
  meanAerodynamicOpposition: 20,
  peaks: {
    feelsLikeC: 24,
    gustMs: 8,
    precipitationRateMmH: 0,
    precipitationProbabilityPct: 5,
  },
};

const conditionsFit: ConditionsSuitabilityAssessment = {
  value: 0.76,
  label: 'favorable',
  version: 'conditions-fit-heuristic-v2',
  factors: {
    temperature: 0.04,
    radiation: 0.12,
    aerodynamicOpposition: 0.05,
    precipitation: 0.01,
  },
};

const exposureSummary = {
  geometricSolarElevationDeg: { minimum: 5, maximum: 25 },
  apparentSolarElevationDeg: { minimum: 5.1, maximum: 25.1 },
  daylightFraction: 1,
  mappedWoodlandFraction: 0,
  coverageCompleteness: 'complete' as const,
};

describe('runner-facing conditions presentation', () => {
  it.each([
    [0, 'none'],
    [1, 'minimal'],
    [99_999, 'minimal'],
    [100_000, 'low'],
    [499_999, 'low'],
    [500_000, 'moderate'],
    [1_499_999, 'moderate'],
    [1_500_000, 'high'],
  ] as const)('bands a radiation dose of %d J/m² as %s sun exposure', (dose, level) => {
    expect(sunExposureLevel(dose)).toBe(level);
  });

  it.each([
    [0, 'minimal'],
    [1, 'minimal'],
    [49, 'minimal'],
    [50, 'low'],
    [199, 'low'],
    [200, 'moderate'],
    [599, 'moderate'],
    [600, 'high'],
  ] as const)('bands point radiation of %d W/m² as %s intensity', (radiation, level) => {
    expect(sunlightIntensityLevel(radiation)).toBe(level);
  });

  it('uses solar geometry to distinguish night from a zero-valued dawn forecast bucket', () => {
    expect(sunlightIntensityLevel(0, false)).toBe('none');
    expect(sunlightIntensityLevel(0, true)).toBe('minimal');
  });

  it.each([
    [0, 'little-resistance'],
    [0.019, 'little-resistance'],
    [0.02, 'light-resistance'],
    [0.079, 'light-resistance'],
    [0.08, 'moderate-resistance'],
    [0.139, 'moderate-resistance'],
    [0.14, 'strong-resistance'],
  ] as const)('bands a wind factor of %d as %s', (factor, level) => {
    expect(windEffectLevel(factor)).toBe(level);
  });

  it.each([
    [0, 'minimal'],
    [0.02, 'low'],
    [0.08, 'moderate'],
    [0.15, 'high'],
  ] as const)('bands a factor penalty of %d as %s impact', (factor, level) => {
    expect(conditionsImpactLevel(factor)).toBe(level);
  });

  it('turns physical measurements into consistent runner-facing labels and details', () => {
    expect(
      presentRunConditions({
        durationSeconds: 3600,
        physicalConditions,
        exposureSummary,
        conditionsFit,
      }),
    ).toMatchObject({
      overallLabel: 'Favorable',
      planningIndex: 76,
      dominantFactorStory: 'Sun and warmth are the main tradeoff',
      sunExposure: {
        level: 'moderate',
        label: 'Moderate',
        doseKJm2: 1080,
        meanIntensityWm2: 300,
      },
      windEffect: {
        level: 'light-resistance',
        headline: 'Light',
        label: 'Light resistance',
        apparentAirflowMs: 4,
      },
      factors: [
        { key: 'temperature', label: 'Temperature', impact: 'low', penaltyPoints: 4 },
        { key: 'radiation', label: 'Sun and warmth', impact: 'moderate', penaltyPoints: 12 },
        {
          key: 'aerodynamicOpposition',
          label: 'Wind resistance',
          impact: 'low',
          penaltyPoints: 5,
        },
        { key: 'precipitation', label: 'Rain', impact: 'minimal', penaltyPoints: 1 },
      ],
    });
  });

  it('keeps the no-tradeoff story when every factor is negligible', () => {
    const result = presentRunConditions({
      durationSeconds: 1800,
      physicalConditions: { ...physicalConditions, radiationDoseJm2: 0 },
      exposureSummary: { ...exposureSummary, daylightFraction: 0 },
      conditionsFit: {
        ...conditionsFit,
        value: 0.99,
        factors: {
          temperature: 0.004,
          radiation: 0,
          aerodynamicOpposition: 0,
          precipitation: 0,
        },
      },
    });
    expect(result.dominantFactorStory).toBe('No major forecast tradeoffs');
    expect(result.sunExposure.label).toBe('None');
    expect(result.windEffect.label).toBe('Little resistance');
  });

  it('describes long low-intensity sunlight as accumulated exposure', () => {
    const result = presentRunConditions({
      durationSeconds: 4 * 3600,
      physicalConditions: { ...physicalConditions, radiationDoseJm2: 1_600_000 },
      exposureSummary,
      conditionsFit,
    });

    expect(result.sunExposure).toMatchObject({
      label: 'High',
      doseKJm2: 1600,
    });
    expect(result.sunExposure.meanIntensityWm2).toBeCloseTo(111.11, 2);
  });

  it('reports no sun after sunset even if the forecast interval retains radiation', () => {
    const result = presentRunConditions({
      durationSeconds: 1800,
      physicalConditions: { ...physicalConditions, radiationDoseJm2: 20_000 },
      exposureSummary: { ...exposureSummary, daylightFraction: 0 },
      conditionsFit,
    });

    expect(result.sunExposure).toMatchObject({ level: 'none', label: 'None' });
  });
});
