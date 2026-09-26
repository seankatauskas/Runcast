import { describe, expect, it } from 'vitest';
import { osmEvidenceFixtures } from '../../test-fixtures/osm-fixtures';
import { assembleWoodlandEvidence, woodlandEvidenceForRoute } from './coverage';
import type { PlanningRoute } from './types';

describe('assembleWoodlandEvidence', () => {
  for (const [name, fixture] of Object.entries(osmEvidenceFixtures)) {
    it(name, () => {
      const assembly = assembleWoodlandEvidence(fixture.response);
      expect(assembly.evidence).toBe(fixture.expected.evidence);
      expect(assembly.completeness).toBe(fixture.expected.completeness);
      expect(assembly.polygons).toHaveLength(fixture.expected.polygonCount);
      expect(assembly.polygons.reduce((count, polygon) => count + polygon.holes.length, 0)).toBe(
        fixture.expected.holeCount,
      );
      expect(assembly.reasons).toEqual(fixture.expected.reasons);
    });
  }

  it('keeps invalid relation evidence unknown along the route', () => {
    const route: PlanningRoute = {
      schemaVersion: 2,
      id: 'route',
      name: 'Route',
      part: {
        points: [
          { lat: 41.9, lon: -87.6, elevationM: 0 },
          { lat: 41.91, lon: -87.59, elevationM: 0 },
        ],
      },
      cumulativeDistanceM: [0, 1000],
      totalDistanceM: 1000,
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
    };
    const assembly = assembleWoodlandEvidence(
      osmEvidenceFixtures.timeoutLikePartialResponse.response,
    );
    const evidence = woodlandEvidenceForRoute(route, assembly, 'overpass', Date.now());
    expect(new Set(evidence.values)).toEqual(new Set(['unknown']));
    expect(evidence.confidence).toBeNull();
  });
});
