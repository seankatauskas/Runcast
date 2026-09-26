import { describe, expect, it } from 'vitest';
import { angleDelta, bearing, cumulativeDistances, haversine, normalizeBearing } from './geo';

describe('haversine', () => {
  it('is zero for identical points', () => {
    const p = { lat: 41.9, lon: -87.6 };
    expect(haversine(p, p)).toBe(0);
  });

  it('matches the known length of one degree of latitude (~111.2 km)', () => {
    const d = haversine({ lat: 41, lon: -87.6 }, { lat: 42, lon: -87.6 });
    expect(d).toBeGreaterThan(110_900);
    expect(d).toBeLessThan(111_400);
  });

  it('shrinks east–west distance with latitude (cos φ)', () => {
    const atEquator = haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const atChicago = haversine({ lat: 41.88, lon: -87.6 }, { lat: 41.88, lon: -86.6 });
    expect(atChicago / atEquator).toBeCloseTo(Math.cos((41.88 * Math.PI) / 180), 2);
  });

  it('is symmetric', () => {
    const a = { lat: 41.96, lon: -87.64 };
    const b = { lat: 41.87, lon: -87.62 };
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 9);
  });
});

describe('bearing', () => {
  it('points north, east, south, west for cardinal displacements', () => {
    const o = { lat: 41.9, lon: -87.6 };
    expect(bearing(o, { lat: 42.0, lon: -87.6 })).toBeCloseTo(0, 5);
    expect(bearing(o, { lat: 41.9, lon: -87.5 })).toBeCloseTo(90, 0);
    expect(bearing(o, { lat: 41.8, lon: -87.6 })).toBeCloseTo(180, 5);
    expect(bearing(o, { lat: 41.9, lon: -87.7 })).toBeCloseTo(270, 0);
  });
});

describe('angle helpers', () => {
  it('normalizes into [0, 360)', () => {
    expect(normalizeBearing(-90)).toBe(270);
    expect(normalizeBearing(720)).toBe(0);
    expect(normalizeBearing(359.5)).toBe(359.5);
  });

  it('angleDelta takes the short way around', () => {
    expect(angleDelta(350, 10)).toBe(-20);
    expect(angleDelta(10, 350)).toBe(20);
    expect(angleDelta(180, 0)).toBe(180);
    expect(angleDelta(90, 90)).toBe(0);
  });
});

describe('cumulativeDistances', () => {
  it('starts at zero and is monotonic', () => {
    const pts = [
      { lat: 41.9, lon: -87.6 },
      { lat: 41.91, lon: -87.6 },
      { lat: 41.92, lon: -87.61 },
    ];
    const cum = cumulativeDistances(pts);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeGreaterThan(0);
    expect(cum[2]).toBeGreaterThan(cum[1]);
    expect(cum[2]).toBeCloseTo(haversine(pts[0], pts[1]) + haversine(pts[1], pts[2]), 6);
  });
});
