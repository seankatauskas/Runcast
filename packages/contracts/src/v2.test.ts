import { describe, expect, it } from 'vitest';
import { plannableRouteV2Schema, planningBundleV2Schema } from './v2';

describe('V2 additive contracts', () => {
  it('preserves missing and real sea-level elevation distinctly', () => {
    const route = plannableRouteV2Schema.parse({
      schemaVersion: 2,
      id: 'route',
      name: 'Route',
      part: {
        points: [
          { lat: 1, lon: 2, elevationM: null },
          { lat: 1.1, lon: 2.1, elevationM: 0 },
        ],
      },
      cumulativeDistanceM: [0, 100],
      totalDistanceM: 100,
      quality: {
        schemaVersion: 2,
        trackCount: 1,
        trackSegmentCount: 1,
        routeCount: 0,
        invalidPointCount: 0,
        duplicatePointCount: 0,
        missingElevationCount: 1,
        elevationStatus: 'partial',
        reasons: ['route.elevation-partial'],
      },
    });
    expect(route.part.points.map((point) => point.elevationM)).toEqual([null, 0]);
  });

  it('rejects unaligned route distance arrays', () => {
    expect(() =>
      plannableRouteV2Schema.parse({
        schemaVersion: 2,
        id: 'route',
        name: 'Route',
        part: {
          points: [
            { lat: 1, lon: 2, elevationM: 0 },
            { lat: 1.1, lon: 2.1, elevationM: 1 },
          ],
        },
        cumulativeDistanceM: [0, 50, 100],
        totalDistanceM: 100,
        quality: {
          schemaVersion: 2,
          trackCount: 1,
          trackSegmentCount: 1,
          routeCount: 0,
          invalidPointCount: 0,
          duplicatePointCount: 0,
          missingElevationCount: 0,
          elevationStatus: 'complete',
          reasons: [],
        },
      }),
    ).toThrow(/points and cumulative/);
  });

  it('strictly rejects unknown bundle fields', () => {
    expect(() => planningBundleV2Schema.parse({ extra: true })).toThrow();
  });
});
