/**
 * Spherical-earth geometry. At running scale (meters to tens of km) the
 * sphere approximation is accurate to well under 0.5%, which is far below
 * GPS noise in the source GPX.
 */
import type { LatLon, RoutePoint } from './types';

const EARTH_RADIUS = 6371008.8; // mean earth radius, meters

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Normalize an angle in degrees to [0, 360). */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed smallest difference a − b in degrees, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Great-circle distance between two points, meters (haversine). */
export function haversine(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLam = toRad(b.lon - a.lon);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLam = toRad(b.lon - a.lon);
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

/**
 * Point at fraction t (0..1) between a and b. Linear in lat/lon/ele —
 * exact enough for GPX segments, which are tens of meters long.
 */
export function lerpPoint(a: RoutePoint, b: RoutePoint, t: number): RoutePoint {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    ele: a.ele + (b.ele - a.ele) * t,
  };
}

/** Cumulative distance along a polyline, meters. result[0] === 0. */
export function cumulativeDistances(points: LatLon[]): number[] {
  const out = new Array<number>(points.length);
  out[0] = 0;
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1] + haversine(points[i - 1], points[i]);
  }
  return out;
}
