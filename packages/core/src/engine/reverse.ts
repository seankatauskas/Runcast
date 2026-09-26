/** Route geometry transforms retained for stored route DTOs and map consumers. */
import { cumulativeDistances, haversine } from './geo';
import { positionAt } from './interpolate';
import type { Route } from './types';

export function reverseRoute(route: Route): Route {
  const points = [...route.points].reverse();
  const cumulative = cumulativeDistances(points);
  return {
    ...route,
    points,
    cumulative,
    totalDistance: cumulative[cumulative.length - 1],
  };
}

/**
 * Does the route retrace itself? Probe pairs of mirrored fractions and
 * call it an out-and-back when ≈all of them land within tolerance — GPS
 * traces of the two legs never coincide exactly.
 */
export function isOutAndBack(route: Route, toleranceM = 30): boolean {
  if (route.points.length < 2 || route.totalDistance <= 0) return false;
  const PROBES = 32;
  let hits = 0;
  for (let i = 1; i <= PROBES; i++) {
    // Fractions in (0, 0.5): each probe compares a point on the first half
    // with its mirror on the second.
    const f = i / (2 * (PROBES + 1));
    const a = positionAt(route, f * route.totalDistance).position;
    const b = positionAt(route, (1 - f) * route.totalDistance).position;
    if (haversine(a, b) < toleranceM) hits++;
  }
  return hits >= PROBES * 0.9;
}

/** Does the route finish where it started, allowing for ordinary GPS drift? */
export function isClosedLoop(route: Route, toleranceM = 30): boolean {
  if (route.points.length < 2 || route.totalDistance <= 0) return false;
  return haversine(route.points[0], route.points[route.points.length - 1]) < toleranceM;
}
