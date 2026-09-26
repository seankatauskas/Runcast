import { describe, expect, it } from 'vitest';
import { cumulativeDistances } from './geo';
import { positionAt } from './interpolate';
import { isClosedLoop, isOutAndBack, reverseRoute } from './reverse';
import type { Route, RoutePoint } from './types';

function mkRoute(points: RoutePoint[], id = 'r'): Route {
  const cumulative = cumulativeDistances(points);
  return {
    id,
    name: id,
    points,
    cumulative,
    totalDistance: cumulative[cumulative.length - 1],
  };
}

/** One-way, due north, ~2 km, with a rising elevation profile. */
function northLine(): Route {
  const points: RoutePoint[] = [];
  for (let i = 0; i <= 20; i++) {
    points.push({ lat: 41.9 + i * 0.00089932, lon: -87.6, ele: 180 + i });
  }
  return mkRoute(points, 'line');
}

/** 2 km north then the same 2 km back south. */
function outAndBack(): Route {
  const points: RoutePoint[] = [];
  for (let i = 0; i <= 20; i++) {
    points.push({ lat: 41.9 + i * 0.00089932, lon: -87.6, ele: 180 });
  }
  for (let i = 19; i >= 0; i--) {
    points.push({ lat: 41.9 + i * 0.00089932, lon: -87.6, ele: 180 });
  }
  return mkRoute(points, 'oab');
}

/** A ~square loop, ~500 m per side. */
function squareLoop(): Route {
  const d = 0.0045;
  const corners: [number, number][] = [
    [41.9, -87.6],
    [41.9 + d, -87.6],
    [41.9 + d, -87.6 + d],
    [41.9, -87.6 + d],
    [41.9, -87.6],
  ];
  const points: RoutePoint[] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      points.push({
        lat: corners[c][0] + (corners[c + 1][0] - corners[c][0]) * t,
        lon: corners[c][1] + (corners[c + 1][1] - corners[c][1]) * t,
        ele: 180,
      });
    }
  }
  points.push({ lat: 41.9, lon: -87.6, ele: 180 });
  return mkRoute(points, 'loop');
}

describe('reverseRoute', () => {
  it('mirrors geometry: position at d equals the original at total − d', () => {
    const route = northLine();
    const rev = reverseRoute(route);
    expect(rev.totalDistance).toBeCloseTo(route.totalDistance, 6);
    expect(rev.cumulative[0]).toBe(0);
    for (const f of [0, 0.1, 0.33, 0.5, 0.77, 1]) {
      const d = f * route.totalDistance;
      const a = positionAt(rev, d).position;
      const b = positionAt(route, route.totalDistance - d).position;
      expect(a.lat).toBeCloseTo(b.lat, 9);
      expect(a.lon).toBeCloseTo(b.lon, 9);
      expect(a.ele).toBeCloseTo(b.ele, 6);
    }
  });

  it('keeps id and name — reversal is presentation state, not a new route', () => {
    const rev = reverseRoute(northLine());
    expect(rev.id).toBe('line');
    expect(rev.name).toBe('line');
  });
});

describe('isOutAndBack', () => {
  it('recognizes a true out-and-back', () => {
    expect(isOutAndBack(outAndBack())).toBe(true);
  });

  it('rejects a loop and a one-way line', () => {
    expect(isOutAndBack(squareLoop())).toBe(false);
    expect(isOutAndBack(northLine())).toBe(false);
  });
});

describe('isClosedLoop', () => {
  it('recognizes routes whose finish returns to their start', () => {
    expect(isClosedLoop(squareLoop())).toBe(true);
    expect(isClosedLoop(outAndBack())).toBe(true);
  });

  it('rejects a point-to-point route', () => {
    expect(isClosedLoop(northLine())).toBe(false);
  });
});
