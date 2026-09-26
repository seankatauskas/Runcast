import { describe, expect, it } from 'vitest';
import type { RouteConditionsProfile, RouteConditionsSample } from './pipeline';
import {
  buildRouteConditionSplits,
  classifyRouteWind,
  presentRouteConditionsProfile,
} from './routeConditionsPresentation';

function sample(
  time: number,
  distanceM: number,
  overrides: Partial<RouteConditionsSample> = {},
): RouteConditionsSample {
  return {
    time,
    distanceM,
    daylight: true,
    elevationM: 10,
    woodlandEvidence: 'no-mapped-woodland',
    airTemperatureC: 19,
    feelsLikeC: 20,
    radiationWm2: 300,
    directNormalRadiationWm2: 200,
    diffuseRadiationWm2: 100,
    precipitationProbabilityPct: 0,
    precipitationRateMmH: 0,
    gustMs: 6,
    ambientWindSpeedMs: 5,
    ambientHeadwindMs: 5,
    ambientCrosswindMs: 0,
    apparentAirflowMs: 8,
    apparentCrossTrackMs: 0,
    aerodynamicOppositionDelta: 20,
    ...overrides,
  };
}

function profile(samples: RouteConditionsSample[]): RouteConditionsProfile {
  return {
    schemaVersion: 2,
    startTime: samples[0].time,
    finishTime: samples.at(-1)!.time,
    durationSeconds: (samples.at(-1)!.time - samples[0].time) / 1000,
    radiationDoseJm2: 0,
    woodland: { mappedFraction: 0.5, completeness: 'complete', confidence: 0.8 },
    samples,
  };
}

describe('route conditions profile presentation', () => {
  it('uses time-weighted mean intensity and exact threshold-crossing durations', () => {
    const result = presentRouteConditionsProfile(
      profile([sample(0, 0, { radiationWm2: 0 }), sample(100_000, 1000, { radiationWm2: 800 })]),
    );

    expect(result.forecastSunlight.meanIntensityWm2).toBe(400);
    expect(result.forecastSunlight.level).toBe('moderate');
    expect(result.forecastSunlight.secondsByLevel).toEqual({
      none: 0,
      minimal: 6.25,
      low: 18.75,
      moderate: 50,
      high: 25,
    });
  });

  it('keeps average sun classification independent of run duration', () => {
    const short = presentRouteConditionsProfile(profile([sample(0, 0), sample(600_000, 1000)]));
    const long = presentRouteConditionsProfile(profile([sample(0, 0), sample(3_600_000, 1000)]));

    expect(short.forecastSunlight.level).toBe('moderate');
    expect(long.forecastSunlight.level).toBe(short.forecastSunlight.level);
    expect(long.forecastSunlight.secondsByLevel.moderate).toBe(
      6 * short.forecastSunlight.secondsByLevel.moderate,
    );
  });

  it('interpolates air temperature at split boundaries', () => {
    const splits = buildRouteConditionSplits(
      profile([
        sample(0, 0, { airTemperatureC: 10 }),
        sample(1_000_000, 1000, { airTemperatureC: 20 }),
      ]),
      500,
    );

    expect(splits).toHaveLength(2);
    expect(splits.map((split) => split.meanAirTemperatureC)).toEqual([12.5, 17.5]);
  });

  it('reports no forecast sun when the entire route is after sunset', () => {
    const result = presentRouteConditionsProfile(
      profile(
        Array.from({ length: 11 }, (_, index) =>
          sample(index * 100, index * 100, { daylight: false, radiationWm2: 20 }),
        ),
      ),
    );

    expect(result.forecastSunlight.level).toBe('none');
    expect(result.forecastSunlight.secondsByLevel.none).toBeCloseTo(1);
    expect(result.forecastSunlight.secondsByLevel).toMatchObject({
      minimal: 0,
      low: 0,
      moderate: 0,
      high: 0,
    });
  });

  it('keeps a daylight portion minimally visible when the hourly radiation bucket is zero', () => {
    const result = presentRouteConditionsProfile(
      profile([
        sample(0, 0, { daylight: false, radiationWm2: 0 }),
        sample(100_000, 1000, { daylight: true, radiationWm2: 0 }),
      ]),
    );

    expect(result.forecastSunlight.level).toBe('minimal');
    expect(result.forecastSunlight.secondsByLevel).toEqual({
      none: 50,
      minimal: 50,
      low: 0,
      moderate: 0,
      high: 0,
    });
  });

  it.each([
    [{ ambientWindSpeedMs: 1.49, ambientHeadwindMs: 1.49 }, 'calm'],
    [{ ambientWindSpeedMs: 6, ambientHeadwindMs: 3 }, 'headwind'],
    [{ ambientWindSpeedMs: 6, ambientHeadwindMs: -3 }, 'tailwind'],
    [{ ambientWindSpeedMs: 6, ambientHeadwindMs: 2.9 }, 'crosswind'],
  ] as const)('classifies runner-relative ambient wind', (input, expected) => {
    expect(classifyRouteWind(input)).toBe(expected);
  });

  it('describes a headwind outbound and tailwind home using elapsed time', () => {
    const result = presentRouteConditionsProfile(
      profile([
        sample(0, 0, { ambientHeadwindMs: 5 }),
        sample(400_000, 400, { ambientHeadwindMs: 5 }),
        sample(600_000, 600, { ambientHeadwindMs: -5 }),
        sample(1_000_000, 1000, { ambientHeadwindMs: -5, gustMs: 11 }),
      ]),
    );

    expect(result.wind.story).toBe('headwind-out-tailwind-home');
    expect(result.wind.maximumHeadwindMs).toBe(5);
    expect(result.wind.maximumTailwindMs).toBe(5);
    expect(result.wind.peakGustMs).toBe(11);
  });

  it('builds unit splits with interpolated boundaries and evidence-aware summaries', () => {
    const result = buildRouteConditionSplits(
      profile([
        sample(0, 0, { woodlandEvidence: 'mapped-woodland', radiationWm2: 100 }),
        sample(300_000, 1000, { woodlandEvidence: 'mapped-woodland', radiationWm2: 300 }),
        sample(600_000, 2000, {
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 700,
          ambientHeadwindMs: -5,
          gustMs: 12,
        }),
      ]),
      1000,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      index: 1,
      startDistanceM: 0,
      endDistanceM: 1000,
      speedMs: 1000 / 300,
      forecastSunlightLevel: 'moderate',
      woodlandEvidenceFraction: 1,
      windClass: 'headwind',
    });
    expect(result[1]).toMatchObject({
      index: 2,
      startDistanceM: 1000,
      endDistanceM: 2000,
      forecastSunlightLevel: 'moderate',
      peakGustMs: 12,
    });
  });

  it('does not report a woodland percentage from incomplete evidence', () => {
    const input = profile([
      sample(0, 0, { woodlandEvidence: 'mapped-woodland' }),
      sample(100_000, 1000, { woodlandEvidence: 'unknown' }),
    ]);
    input.woodland = { mappedFraction: null, completeness: 'partial', confidence: null };

    expect(presentRouteConditionsProfile(input).woodlandEvidence.mappedFraction).toBeNull();
    expect(buildRouteConditionSplits(input, 1000)[0].woodlandEvidenceFraction).toBeNull();
  });
});
