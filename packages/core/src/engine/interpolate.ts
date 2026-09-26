/** Shared polyline interpolation for route maps, acquisition, and current timing. */
import { bearing, lerpPoint } from './geo';
import type { Route, RoutePoint } from './types';

/** Target spacing between samples, meters. */
export const SAMPLE_SPACING = 50;
/** Hard cap so a 100 km GPX can't melt the UI. */
export const MAX_SAMPLES = 500;

export interface RoutePosition {
  position: RoutePoint;
  /** Direction of travel at this point, degrees. */
  bearing: number;
  /** Index of the segment (points[i] → points[i+1]) containing d. */
  segment: number;
}

/**
 * Index i such that cumulative[i] <= d < cumulative[i+1], clamped to a valid
 * segment index. Binary search: O(log n) per lookup.
 */
export function segmentIndexAt(cumulative: number[], d: number): number {
  let lo = 0;
  let hi = cumulative.length - 2;
  if (d <= 0) return 0;
  if (d >= cumulative[hi + 1]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Position and travel bearing at distance d along the route (d clamped). */
export function positionAt(route: Route, d: number): RoutePosition {
  const { points, cumulative } = route;
  if (points.length === 1) {
    return { position: points[0], bearing: 0, segment: 0 };
  }
  const i = segmentIndexAt(cumulative, d);
  const segLen = cumulative[i + 1] - cumulative[i];
  const t = segLen > 0 ? Math.min(Math.max((d - cumulative[i]) / segLen, 0), 1) : 0;
  return {
    position: lerpPoint(points[i], points[i + 1], t),
    bearing: bearing(points[i], points[i + 1]),
    segment: i,
  };
}
