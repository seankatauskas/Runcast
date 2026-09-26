import { describe, expect, it } from 'vitest';
import {
  GPX_MAX_POINTS,
  buildPointCountGpx,
  gpxSourceFixtures,
} from '../../test-fixtures/gpx-fixtures';
import {
  GPX_MAX_TOTAL_DISTANCE_M,
  PlanningGpxParseError,
  adaptLegacyRoute,
  parsePlanningGpx,
} from './gpx';

describe('parsePlanningGpx', () => {
  for (const [name, fixture] of Object.entries(gpxSourceFixtures)) {
    it(name, () => {
      if (fixture.expected.outcome === 'accepted') {
        const route = parsePlanningGpx(fixture.xml, name, 'Fallback');
        expect(route.part.points).toHaveLength(fixture.expected.pointCount);
        expect(route.quality.elevationStatus).toBe(fixture.expected.elevationStatus);
        if ('duplicateCount' in fixture.expected) {
          expect(route.quality.duplicatePointCount).toBe(fixture.expected.duplicateCount);
          expect(route.quality.reasons).toContain('route.duplicate-point-removed');
        }
      } else {
        try {
          parsePlanningGpx(fixture.xml, name, 'Fallback');
          throw new Error('expected fixture rejection');
        } catch (error) {
          expect(error).toBeInstanceOf(PlanningGpxParseError);
          expect((error as PlanningGpxParseError).code).toBe(fixture.expected.reason);
        }
      }
    });
  }

  it('enforces the raw point limit before duplicate removal', () => {
    expect(() =>
      parsePlanningGpx(buildPointCountGpx(GPX_MAX_POINTS + 1), 'limit', 'Limit'),
    ).toThrow(expect.objectContaining({ code: 'POINT_LIMIT_EXCEEDED' }));
  });

  it('enforces the UTF-8 byte limit including multibyte names', () => {
    const oversized = `<gpx><metadata><name>${'🏃'.repeat(600_000)}</name></metadata><rte><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2.1"/></rte></gpx>`;
    expect(() => parsePlanningGpx(oversized, 'bytes', 'Bytes')).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }),
    );
  });

  it('rejects a route beyond the supported aggregate distance', () => {
    const oversizedDistance =
      '<gpx><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="3"/></rte></gpx>';
    expect(() => parsePlanningGpx(oversizedDistance, 'distance', 'Distance')).toThrow(
      expect.objectContaining({ code: 'ROUTE_DISTANCE_EXCEEDED' }),
    );
  });

  it('accepts a route comfortably inside the aggregate distance limit', () => {
    const supported = '<gpx><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="2"/></rte></gpx>';
    expect(parsePlanningGpx(supported, 'distance', 'Distance').totalDistanceM).toBeLessThan(
      GPX_MAX_TOTAL_DISTANCE_M,
    );
  });

  it('marks legacy elevations ambiguous and forces a flat timing reason', () => {
    const adapted = adaptLegacyRoute({
      id: 'legacy',
      name: 'Legacy',
      points: [
        { lat: 0, lon: 0, ele: 0 },
        { lat: 0, lon: 0.01, ele: 0 },
      ],
      cumulative: [0, 1112],
      totalDistance: 1112,
    });
    expect(adapted.quality.elevationStatus).toBe('legacy-unknown');
    expect(adapted.quality.reasons).toContain('route.elevation-legacy-unknown');
  });
});
