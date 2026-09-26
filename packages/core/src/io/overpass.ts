/**
 * Tree-cover lookup for uploaded routes via the Overpass API.
 *
 * We pull wood/forest polygons in the route's bounding box and rasterize a
 * CoverageMask: for each 50 m step along the route, point-in-polygon against
 * the canopy outlines (ray casting; relation holes ignored — at running
 * scale a clearing inside a wood rarely changes the answer for a trail).
 * Overpass is a best-effort public service: any failure degrades to
 * 'unknown' coverage, which the exposure model treats as open ground.
 * The bundled demo routes never hit this — their masks ship precomputed.
 */
import { positionAt } from '../engine/interpolate';
import { GPX_MAX_TOTAL_DISTANCE_M } from '../engine/planning/gpx';
import type { Coverage, CoverageMask, LatLon, Route } from '../engine/types';
import { fetchWithDeadline, OVERPASS_TIMEOUT_MS } from './deadline';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MASK_RESOLUTION = 50; // meters
export const COVERAGE_MASK_MAX_VALUES = Math.floor(GPX_MAX_TOTAL_DISTANCE_M / MASK_RESOLUTION) + 1;

interface OverpassElement {
  type: string;
  geometry?: { lat: number; lon: number }[];
}

function routeBbox(route: Route, padDeg = 0.002): string {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const p of route.points) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
  }
  return `${s - padDeg},${w - padDeg},${n + padDeg},${e + padDeg}`;
}

function pointInRing(p: LatLon, ring: { lat: number; lon: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function unknownMask(route: Route): CoverageMask {
  const n = Math.floor(route.totalDistance / MASK_RESOLUTION) + 1;
  if (!Number.isSafeInteger(n) || n < 1 || n > COVERAGE_MASK_MAX_VALUES) {
    throw new RangeError('Route distance exceeds the supported coverage-mask size.');
  }
  return {
    resolution: MASK_RESOLUTION,
    values: new Array<Coverage>(n).fill('unknown'),
  };
}

export async function fetchCoverage(route: Route, signal?: AbortSignal): Promise<CoverageMask> {
  const bbox = routeBbox(route);
  const query = `
    [out:json][timeout:20];
    (
      way["natural"="wood"](${bbox});
      way["landuse"="forest"](${bbox});
      relation["natural"="wood"](${bbox});
      relation["landuse"="forest"](${bbox});
    );
    out geom;`;

  try {
    const res = await fetchWithDeadline(
      OVERPASS_URL,
      {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      },
      OVERPASS_TIMEOUT_MS,
    );
    if (!res.ok) return unknownMask(route);
    const body = (await res.json()) as { elements: OverpassElement[] };

    const rings = body.elements
      .map((el) => el.geometry)
      .filter((g): g is { lat: number; lon: number }[] => !!g && g.length >= 3);
    if (rings.length === 0) {
      // A successful query with no woods means genuinely open ground.
      const mask = unknownMask(route);
      return { ...mask, values: mask.values.map(() => 'open' as Coverage) };
    }

    const n = unknownMask(route).values.length;
    const values: Coverage[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const { position } = positionAt(route, i * MASK_RESOLUTION);
      values[i] = rings.some((r) => pointInRing(position, r)) ? 'tree' : 'open';
    }
    return { resolution: MASK_RESOLUTION, values };
  } catch {
    if (signal?.aborted) {
      // Not DOMException: that class doesn't exist under Hermes/RN.
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    return unknownMask(route);
  }
}
