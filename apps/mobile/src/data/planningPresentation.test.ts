import type { EvaluatedRunV3, Route, RouteConditionsProfile } from '@runcast/core';
import { playbackDistanceAtTime } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import {
  planningPlaybackTimeline,
  safetyAlerts,
  outOfSunCoordinates,
} from './planningPresentation';

function sample(
  distanceM: number,
  time: number,
  woodlandEvidence: 'no-mapped-woodland' | 'mapped-woodland',
) {
  return {
    distanceM,
    time,
    daylight: true,
    elevationM: 10,
    woodlandEvidence,
    airTemperatureC: 20,
    feelsLikeC: 21,
    radiationWm2: 500,
    directNormalRadiationWm2: 400,
    diffuseRadiationWm2: 100,
    precipitationProbabilityPct: 10,
    precipitationRateMmH: 0,
    gustMs: 4,
    ambientWindSpeedMs: 3,
    ambientHeadwindMs: 2,
    ambientCrosswindMs: 1,
    apparentAirflowMs: 5,
    apparentCrossTrackMs: 1,
    aerodynamicOppositionDelta: 0.1,
  } as const;
}

const profile: RouteConditionsProfile = {
  schemaVersion: 2,
  startTime: 1_000,
  finishTime: 11_000,
  durationSeconds: 10,
  radiationDoseJm2: 5_000,
  woodland: { mappedFraction: 0.5, completeness: 'complete', confidence: 1 },
  samples: [sample(0, 1_000, 'no-mapped-woodland'), sample(1_000, 11_000, 'mapped-woodland')],
};

describe('planning presentation', () => {
  it('builds V2 safety alerts without reading legacy alerts', () => {
    const plan = {
      safety: { reasons: ['safety.high-wind'] },
      physicalConditions: {
        peaks: { gustMs: 18, feelsLikeC: 35, precipitationRateMmH: 7 },
      },
    } as EvaluatedRunV3;
    expect(safetyAlerts(plan)).toEqual([{ kind: 'high-wind', peak: 18 }]);
  });

  it('uses the conditions profile for playback and remains unavailable without one', () => {
    const timeline = planningPlaybackTimeline(profile);
    expect(timeline).toMatchObject({ durationMs: 10_000 });
    expect(playbackDistanceAtTime(timeline!.samples, 6_000)).toBe(500);
    expect(planningPlaybackTimeline(null)).toBeNull();
  });

  it('derives map shade geometry from the V2 profile and route geometry', () => {
    const route: Route = {
      id: 'route',
      name: 'Route',
      points: [
        { lat: 0, lon: 0, ele: 0 },
        { lat: 0, lon: 0.01, ele: 0 },
      ],
      cumulative: [0, 1_000],
      totalDistance: 1_000,
    };
    const mappedProfile = {
      ...profile,
      samples: [sample(0, 1_000, 'mapped-woodland'), sample(1_000, 11_000, 'mapped-woodland')],
    };
    expect(outOfSunCoordinates(route, mappedProfile)).toEqual([
      [
        [0, 0],
        [0.01, 0],
      ],
    ]);

    const activeCanopyProfile: RouteConditionsProfile = {
      ...mappedProfile,
      canopy: {
        availableFraction: 1,
        meanCanopyPct: 80,
        meanBlockedDirectFraction: 0.4,
        completeness: 'complete',
        modelMode: 'active',
      },
    };
    expect(outOfSunCoordinates(route, activeCanopyProfile)).toEqual([]);
  });
});
