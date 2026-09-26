import { describe, expect, it } from 'vitest';
import type { RouteConditionsProfile, RouteConditionsSample } from '@runcast/core';
import {
  alongRouteIdleStory,
  prerunObservations,
  alongRouteLanes,
  routeDistanceForBucket,
  routeLocationLabel,
  routeProgressBucket,
  shouldShowFeelsLike,
} from './alongRouteModel';

function sample(
  distanceM: number,
  overrides: Partial<RouteConditionsSample> = {},
): RouteConditionsSample {
  return {
    distanceM,
    time: distanceM * 1000,
    daylight: true,
    elevationM: 10,
    woodlandEvidence: 'no-mapped-woodland',
    airTemperatureC: 20,
    feelsLikeC: 20,
    radiationWm2: 100,
    directNormalRadiationWm2: 50,
    diffuseRadiationWm2: 50,
    precipitationProbabilityPct: 0,
    precipitationRateMmH: 0,
    gustMs: 5,
    ambientWindSpeedMs: 4,
    ambientHeadwindMs: -3,
    ambientCrosswindMs: 0,
    apparentAirflowMs: 2,
    apparentCrossTrackMs: 0,
    aerodynamicOppositionDelta: -1,
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
    woodland: { mappedFraction: 0, completeness: 'complete', confidence: 1 },
    samples,
  };
}

describe('along route presentation model', () => {
  it('keeps the run-plan lane order and omits unavailable hills', () => {
    expect(alongRouteLanes(profile([sample(0), sample(1000)]))).toEqual([
      'air',
      'sun',
      'wind',
      'rain',
      'hills',
    ]);
    expect(alongRouteLanes(profile([sample(0), sample(1000, { elevationM: null })]))).toEqual([
      'air',
      'sun',
      'wind',
      'rain',
    ]);
  });

  it('shows feels-like only for a meaningful difference', () => {
    expect(shouldShowFeelsLike(20, 20.9)).toBe(false);
    expect(shouldShowFeelsLike(20, 21)).toBe(true);
  });

  it('uses twenty stable route-progress buckets', () => {
    expect(routeProgressBucket(499, 1000)).toBe(10);
    expect(routeDistanceForBucket(11, 1000)).toBe(550);
    expect(routeProgressBucket(2000, 1000)).toBe(20);
  });

  it('uses relative endpoint labels and unit-aware interior distances', () => {
    expect(routeLocationLabel(50, 1000, 'imperial')).toBe('near start');
    expect(routeLocationLabel(950, 1000, 'metric')).toBe('near finish');
    expect(routeLocationLabel(804.672, 1609.344, 'imperial')).toBe('near 0.5 mi');
    expect(routeLocationLabel(5000, 10_000, 'metric')).toBe('near 5.0 km');
  });

  it('prioritizes an active alert location before other route changes', () => {
    const result = alongRouteIdleStory(
      profile([
        sample(0, { airTemperatureC: 18, precipitationRateMmH: 0 }),
        sample(500, { airTemperatureC: 20, precipitationRateMmH: 8 }),
        sample(1000, { airTemperatureC: 22, precipitationRateMmH: 0 }),
      ]),
      [{ kind: 'heavy-rain', peak: 8 }],
      'metric',
    );

    expect(result).toBe('Rain peaks near 0.5 km · Warmest near finish · mostly tailwind');
  });

  it('falls back to a steady route story when no conditions vary', () => {
    expect(alongRouteIdleStory(profile([sample(0), sample(1000)]), [], 'metric')).toBe(
      'Conditions stay fairly steady · mostly tailwind',
    );
  });
});

describe('pre-run observations', () => {
  it('names a peak rather than claiming a continuous temperature trend', () => {
    const route = profile([
      sample(0, { airTemperatureC: 18 }),
      sample(500, { airTemperatureC: 25 }),
      sample(1000, { airTemperatureC: 20 }),
    ]);
    expect(prerunObservations(route, [], 'metric')[0]).toBe('Warmest near 0.5 km');
  });
  it('prioritizes a warning location without repeating the same rain observation', () => {
    const route = profile([
      sample(0),
      sample(500, { precipitationRateMmH: 9 }),
      sample(1000, { airTemperatureC: 24 }),
    ]);
    const result = prerunObservations(route, [{ kind: 'heavy-rain', peak: 9 }], 'metric');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('Rain peaks near 0.5 km');
    expect(result.filter((copy) => copy.includes('Rain'))).toHaveLength(1);
  });
  it('retains lightning uncertainty and labels solar estimates', () => {
    const route = profile([sample(0), sample(1000, { radiationWm2: 500 })]);
    const result = prerunObservations(route, [{ kind: 'thunderstorm', peak: 1 }], 'imperial');
    expect(result[0]).toContain('Lightning possible');
    expect(result[1]).toBe('Estimated sun strongest near finish');
    expect(result.join(' ')).not.toMatch(/guaranteed|shaded/);
  });
  it('does not assume the second half is the return home', () => {
    const route = profile([
      sample(0, { ambientHeadwindMs: 4 }),
      sample(400, { ambientHeadwindMs: 4 }),
      sample(600, { ambientHeadwindMs: -4 }),
      sample(1000, { ambientHeadwindMs: -4 }),
    ]);
    expect(prerunObservations(route, [], 'metric').at(-1)).toBe(
      'Headwind first half, tailwind second half',
    );
    expect(prerunObservations(route, [], 'metric', true).at(-1)).toBe(
      'Headwind out, tailwind home',
    );
  });
  it('describes steady conditions and omits unsupported profiles', () => {
    expect(prerunObservations(profile([sample(0), sample(1000)]), [], 'metric')[0]).toBe(
      'Conditions stay fairly steady',
    );
    expect(prerunObservations(profile([sample(0)]), [], 'metric')).toEqual([]);
  });
});
