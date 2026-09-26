import { describe, expect, it } from 'vitest';
import type { PlanningRoute } from './types';
import { adaptLegacyRoute, parsePlanningGpx } from './gpx';
import { buildRouteTiming } from './timing';

function route(
  elevations: Array<number | null>,
  status: 'complete' | 'partial' | 'absent',
): PlanningRoute {
  return {
    schemaVersion: 2,
    id: 'route',
    name: 'Route',
    part: {
      points: elevations.map((elevationM, index) => ({ lat: 0, lon: index * 0.005, elevationM })),
    },
    cumulativeDistanceM: elevations.map((_, index) => index * 500),
    totalDistanceM: (elevations.length - 1) * 500,
    quality: {
      schemaVersion: 2,
      trackCount: 1,
      trackSegmentCount: 1,
      routeCount: 0,
      invalidPointCount: 0,
      duplicatePointCount: 0,
      missingElevationCount: elevations.filter((value) => value === null).length,
      elevationStatus: status,
      reasons: status === 'complete' ? [] : [`route.elevation-${status}`],
    },
  };
}

describe('buildRouteTiming', () => {
  it('uses exact flat integration for partial and absent elevation', () => {
    for (const input of [route([0, null, 20], 'partial'), route([null, null, null], 'absent')]) {
      const timing = buildRouteTiming(input, 1_000, 4);
      expect(timing.durationSeconds).toBe(250);
      expect(timing.quality).toBe('flat-fallback');
      expect(timing.paceModelVersion).toBe('flat-v1');
      expect(timing.reasons).toContain('timing.flat-fallback');
    }
  });

  it('distinguishes true sea level from missing elevation', () => {
    const timing = buildRouteTiming(route([0, 0, 0], 'complete'), 0, 4);
    expect(timing.quality).toBe('grade-adjusted');
    expect(timing.paceModelVersion).toBe('minetti-clamped-v1');
    expect(timing.durationSeconds).toBe(250);
  });

  it('uses Minetti-clamped timing only for complete hilly elevation', () => {
    const timing = buildRouteTiming(route([0, 100, 100], 'complete'), 0, 4);
    expect(timing.durationSeconds).toBeGreaterThan(250);
    expect(timing.points.length).toBeLessThanOrEqual(500);
  });

  it('adapts persisted V1 zeros as legacy-unknown flat timing', () => {
    const legacy = adaptLegacyRoute({
      id: 'legacy',
      name: 'Legacy',
      points: [
        { lat: 0, lon: 0, ele: 0 },
        { lat: 0, lon: 0.01, ele: 50 },
      ],
      cumulative: [0, 1000],
      totalDistance: 1000,
    });
    expect(buildRouteTiming(legacy, 0, 4).durationSeconds).toBe(250);
  });

  it('parses namespace-prefixed route sources before timing', () => {
    const parsed = parsePlanningGpx(
      '<g:gpx xmlns:g="urn:gpx"><g:rte><g:rtept lat="0" lon="0"><g:ele>0</g:ele></g:rtept><g:rtept lat="0" lon="0.01"><g:ele>0</g:ele></g:rtept></g:rte></g:gpx>',
      'route',
      'Route',
    );
    expect(buildRouteTiming(parsed, 0, 4).finishTime).toBeGreaterThan(0);
  });
});
