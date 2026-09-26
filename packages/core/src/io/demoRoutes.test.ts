import { describe, expect, it } from 'vitest';
import { adaptLegacyRoute } from '../engine/planning/gpx';
import { routeGeometryIdentity } from '../engine/planning/identity';
import { checkedCanopySidecar, DEMO_ROUTES } from './demoRoutes';

describe('demo canopy sidecars', () => {
  it('freezes a complete geometry-bound profile for every demo', () => {
    expect(DEMO_ROUTES).toHaveLength(4);
    for (const demo of DEMO_ROUTES) {
      expect(demo.canopyEvidence).toMatchObject({
        schemaVersion: 3,
        datasetYear: 2025,
        datasetVersion: 'v2025-6',
        sourceResolutionM: 30,
        completeness: 'complete',
      });
      expect(demo.canopyEvidence.coordinateHash).toBe(
        routeGeometryIdentity(adaptLegacyRoute(demo.route)),
      );
      expect(demo.canopyEvidence.routeDistanceM).toHaveLength(demo.canopyEvidence.canopyPct.length);
    }
  });

  it('keeps Central Park evidence-driven and nonzero', () => {
    const centralPark = DEMO_ROUTES.find((demo) => demo.route.id === 'central-park-loop')!;
    expect(centralPark.canopyEvidence.canopyPct.some((value) => value !== null && value > 0)).toBe(
      true,
    );
  });

  it('rejects a profile copied from a different route geometry', () => {
    expect(() => checkedCanopySidecar(DEMO_ROUTES[1].route, DEMO_ROUTES[0].canopyEvidence)).toThrow(
      /Stale or invalid canopy sidecar/,
    );
  });
});
