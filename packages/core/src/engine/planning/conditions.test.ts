import { describe, expect, it } from 'vitest';
import {
  hazardPolicyFixtures,
  timeWeightingFixtures,
} from '../../test-fixtures/evaluation-fixtures';
import {
  assessSafety,
  summarizePhysicalExposure,
  assessConditionsSuitability,
  type TimedConditionSample,
} from './conditions';

function sample(time: number, overrides: Partial<TimedConditionSample> = {}): TimedConditionSample {
  return {
    time,
    airTemperatureC: 20,
    feelsLikeC: 20,
    radiationWm2: 100,
    directNormalRadiationWm2: 60,
    diffuseRadiationWm2: 40,
    precipitationProbabilityPct: 0,
    precipitationRateMmH: 0,
    gustMs: 3,
    weatherCode: 1,
    apparentAirflowMs: 4,
    aerodynamicOpposition: 0,
    ...overrides,
  };
}

describe('assessSafety', () => {
  for (const [name, fixture] of Object.entries(hazardPolicyFixtures)) {
    it(name, () => {
      const overrides = {
        weatherCode: fixture.inputs.weatherCode,
        precipitationRateMmH: fixture.inputs.precipitationMm,
        feelsLikeC: fixture.inputs.feelsLikeC,
        gustMs: fixture.inputs.gustMps,
      };
      const result = assessSafety([sample(0, overrides), sample(60_000, overrides)]);
      expect(result.status).toBe('evaluable');
      if (result.status !== 'evaluable') return;
      expect(result.assessment.tier).toBe(fixture.expected.safety);
      expect(result.assessment.reasons).toEqual(
        fixture.expected.reasons.map(
          (reason) => `safety.${reason.toLowerCase().replace('_', '-')}`,
        ),
      );
    });
  }

  it('makes missing or out-of-range required input unevaluable', () => {
    expect(assessSafety([sample(0), sample(1, { weatherCode: null })]).status).toBe('unevaluable');
    expect(assessSafety([sample(0), sample(1, { gustMs: -1 })]).status).toBe('unevaluable');
  });

  it('never lets favorable conditions compensate for thunder', () => {
    const result = assessSafety([
      sample(0, { weatherCode: 95, airTemperatureC: 11 }),
      sample(60_000, { weatherCode: 95, airTemperatureC: 11 }),
    ]);
    expect(result).toMatchObject({
      status: 'evaluable',
      assessment: { tier: 'ineligible', reasons: ['safety.thunderstorm'] },
    });
  });
});

describe('time-weighted physical conditions and fit', () => {
  const fromFixture = (values: readonly { elapsedMs: number; value: number }[]) =>
    values.map(({ elapsedMs, value }) => sample(elapsedMs, { airTemperatureC: value }));

  const suitabilityAt = (airTemperatureC: number, overrides: Partial<TimedConditionSample> = {}) =>
    assessConditionsSuitability([
      sample(0, {
        airTemperatureC,
        feelsLikeC: airTemperatureC,
        radiationWm2: 0,
        precipitationProbabilityPct: 0,
        precipitationRateMmH: 0,
        aerodynamicOpposition: 0,
        ...overrides,
      }),
      sample(60_000, {
        airTemperatureC,
        feelsLikeC: airTemperatureC,
        radiationWm2: 0,
        precipitationProbabilityPct: 0,
        precipitationRateMmH: 0,
        aerodynamicOpposition: 0,
        ...overrides,
      }),
    ]);

  it('uses trapezoidal elapsed-time weighting invariant to linear resampling', () => {
    const coarse = summarizePhysicalExposure(fromFixture(timeWeightingFixtures.coarse));
    const refined = summarizePhysicalExposure(fromFixture(timeWeightingFixtures.linearlyResampled));
    expect(coarse.status).toBe('ok');
    expect(refined.status).toBe('ok');
    if (coarse.status !== 'ok' || refined.status !== 'ok') return;
    expect(coarse.exposure.meanTemperatureC).toBeCloseTo(
      timeWeightingFixtures.expectedTrapezoidalMean,
      10,
    );
    expect(refined.exposure.meanTemperatureC).toBeCloseTo(coarse.exposure.meanTemperatureC, 10);
  });

  it('integrates radiation dose and precipitation amount by elapsed time', () => {
    const result = summarizePhysicalExposure([
      sample(0, { radiationWm2: 100, precipitationRateMmH: 3 }),
      sample(3_600_000, { radiationWm2: 100, precipitationRateMmH: 3 }),
    ]);
    expect(result).toMatchObject({
      status: 'ok',
      exposure: {
        radiationDoseJm2: 360_000,
        directNormalRadiationDoseJm2: 216_000,
        diffuseRadiationDoseJm2: 144_000,
        precipitationAmountMm: 3,
      },
    });
  });

  it('treats 76°F as mixed rather than challenging from temperature alone', () => {
    const result = suitabilityAt(((76 - 32) * 5) / 9);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.assessment.label).toBe('mixed');
    expect(result.assessment.factors.temperature).toBeCloseTo(0.3417, 4);
  });

  it('reserves challenging heat for hotter air or combined warm-weather stress', () => {
    const hot = suitabilityAt(((83 - 32) * 5) / 9);
    const warmAndSunny = suitabilityAt(((80 - 32) * 5) / 9, { radiationWm2: 800 });

    expect(hot.status).toBe('ok');
    expect(warmAndSunny.status).toBe('ok');
    if (hot.status !== 'ok' || warmAndSunny.status !== 'ok') return;
    expect(hot.assessment.label).toBe('challenging');
    expect(warmAndSunny.assessment.label).toBe('challenging');
  });

  it('uses primitive temperature, radiation, opposition and rain with bounded factors', () => {
    const result = assessConditionsSuitability([
      sample(0, {
        airTemperatureC: 40,
        feelsLikeC: -50,
        radiationWm2: 2_000,
        precipitationProbabilityPct: 100,
        precipitationRateMmH: 10,
        aerodynamicOpposition: 100,
      }),
      sample(60_000, {
        airTemperatureC: 40,
        feelsLikeC: -50,
        radiationWm2: 2_000,
        precipitationProbabilityPct: 100,
        precipitationRateMmH: 10,
        aerodynamicOpposition: 100,
      }),
    ]);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.assessment.version).toBe('conditions-fit-heuristic-v3');
    expect(result.assessment.label).toBe('challenging');
    expect(result.assessment.factors).toMatchObject({
      temperature: 1,
      radiation: 0.25,
      aerodynamicOpposition: 0.2,
      precipitation: 0.3,
    });
  });
});
