import { describe, expect, it } from 'vitest';
import { cumulativeDistances } from './geo';
import { positionAt, segmentIndexAt } from './interpolate';
import type { Route, RoutePoint } from './types';

/** Straight-north test route: points every ~0.009° ≈ 1 km of latitude. */
function northRoute(km: number, elePerKm = 0): Route {
  const points: RoutePoint[] = [];
  for (let i = 0; i <= km; i++) {
    points.push({ lat: 41.9 + i * 0.0089932, lon: -87.6, ele: elePerKm * i });
  }
  const cumulative = cumulativeDistances(points);
  return {
    id: 'north',
    name: 'North line',
    points,
    cumulative,
    totalDistance: cumulative[cumulative.length - 1],
  };
}

describe('segmentIndexAt', () => {
  const cum = [0, 100, 250, 600];
  it('finds the containing segment', () => {
    expect(segmentIndexAt(cum, 0)).toBe(0);
    expect(segmentIndexAt(cum, 99.9)).toBe(0);
    expect(segmentIndexAt(cum, 100)).toBe(1);
    expect(segmentIndexAt(cum, 300)).toBe(2);
  });
  it('clamps outside the route', () => {
    expect(segmentIndexAt(cum, -5)).toBe(0);
    expect(segmentIndexAt(cum, 600)).toBe(2);
    expect(segmentIndexAt(cum, 10_000)).toBe(2);
  });
});

describe('positionAt', () => {
  const route = northRoute(5);

  it('returns endpoints exactly at d=0 and d=total', () => {
    expect(positionAt(route, 0).position).toEqual(route.points[0]);
    const end = positionAt(route, route.totalDistance).position;
    expect(end.lat).toBeCloseTo(route.points[5].lat, 9);
  });

  it('interpolates linearly within a segment (lat and elevation)', () => {
    const climbing = northRoute(5, 10);
    const mid = positionAt(climbing, climbing.cumulative[1] / 2);
    expect(mid.position.lat).toBeCloseTo((route.points[0].lat + route.points[1].lat) / 2, 6);
    expect(mid.position.ele).toBeCloseTo(5, 1);
  });

  it('reports the bearing of travel', () => {
    expect(positionAt(route, 1234).bearing).toBeCloseTo(0, 4);
  });

  it('clamps beyond the ends instead of extrapolating', () => {
    expect(positionAt(route, -100).position.lat).toBe(route.points[0].lat);
    expect(positionAt(route, 1e9).position.lat).toBeCloseTo(route.points[5].lat, 9);
  });
});
