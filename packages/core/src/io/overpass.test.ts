import { describe, expect, it } from 'vitest';
import type { Route } from '../engine/types';
import { COVERAGE_MASK_MAX_VALUES, unknownMask } from './overpass';

function route(totalDistance: number): Route {
  return {
    id: 'route',
    name: 'Route',
    points: [
      { lat: 0, lon: 0, ele: 0 },
      { lat: 0, lon: 0.01, ele: 0 },
    ],
    cumulative: [0, totalDistance],
    totalDistance,
  };
}

describe('coverage mask bounds', () => {
  it('keeps supported masks within the fixed sample ceiling', () => {
    expect(unknownMask(route(250_000)).values).toHaveLength(COVERAGE_MASK_MAX_VALUES);
  });

  it('rejects non-finite and excessive distances before allocation', () => {
    expect(() => unknownMask(route(Number.MAX_VALUE))).toThrow(RangeError);
    expect(() => unknownMask(route(Number.POSITIVE_INFINITY))).toThrow(RangeError);
  });
});
