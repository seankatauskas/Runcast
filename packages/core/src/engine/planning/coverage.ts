import type { LatLon } from '../types';
import type { WoodlandEvidenceProfile, PlanningRoute, WoodlandEvidenceValue } from './types';
import { WOODLAND_EVIDENCE_PARSER_MODEL_VERSION } from './versions';

interface OsmWay {
  type: 'way';
  id: number;
  geometry?: LatLon[];
  tags?: Record<string, string>;
}

interface OsmRelationMember {
  type: 'way';
  ref: number;
  role: string;
  geometry?: LatLon[];
}

interface OsmRelation {
  type: 'relation';
  id: number;
  members: OsmRelationMember[];
  tags?: Record<string, string>;
}

export interface OverpassWoodlandPayload {
  elements: Array<OsmWay | OsmRelation>;
  remark?: string;
}

export interface WoodlandPolygon {
  outer: LatLon[];
  holes: LatLon[][];
}

export interface WoodlandEvidenceAssembly {
  evidence: WoodlandEvidenceValue;
  completeness: 'complete' | 'incomplete' | 'invalid';
  polygons: WoodlandPolygon[];
  reasons: string[];
}

function samePoint(a: LatLon, b: LatLon): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

function isClosed(ring: LatLon[]): boolean {
  return ring.length >= 4 && samePoint(ring[0], ring.at(-1)!);
}

function assembleRings(segments: LatLon[][]): LatLon[][] | null {
  const remaining = segments.map((segment) => [...segment]);
  const rings: LatLon[][] = [];
  while (remaining.length) {
    const ring = remaining.shift()!;
    while (!isClosed(ring)) {
      const tail = ring.at(-1)!;
      const match = remaining.findIndex(
        (segment) => samePoint(segment[0], tail) || samePoint(segment.at(-1)!, tail),
      );
      if (match < 0) return null;
      const [segment] = remaining.splice(match, 1);
      if (samePoint(segment.at(-1)!, tail)) segment.reverse();
      ring.push(...segment.slice(1));
    }
    rings.push(ring);
  }
  return rings;
}

function pointInRing(point: LatLon, ring: LatLon[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    if (
      a.lat > point.lat !== b.lat > point.lat &&
      point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function woodland(tags?: Record<string, string>): boolean {
  return tags?.natural === 'wood' || tags?.landuse === 'forest';
}

export function assembleWoodlandEvidence(
  payload: OverpassWoodlandPayload,
): WoodlandEvidenceAssembly {
  if (payload.remark) {
    return {
      evidence: 'unknown',
      completeness: 'incomplete',
      polygons: [],
      reasons: ['PROVIDER_PARTIAL_RESPONSE'],
    };
  }
  const polygons: WoodlandPolygon[] = [];
  for (const element of payload.elements) {
    if (element.type === 'way' && woodland(element.tags)) {
      if (!element.geometry || !isClosed(element.geometry)) {
        return {
          evidence: 'unknown',
          completeness: element.geometry ? 'invalid' : 'incomplete',
          polygons: [],
          reasons: [element.geometry ? 'UNCLOSED_OUTER' : 'MISSING_MEMBER_GEOMETRY'],
        };
      }
      polygons.push({ outer: element.geometry, holes: [] });
      continue;
    }
    if (element.type !== 'relation' || !woodland(element.tags)) continue;
    if (element.members.some((member) => !member.geometry)) {
      return {
        evidence: 'unknown',
        completeness: 'incomplete',
        polygons: [],
        reasons: ['MISSING_MEMBER_GEOMETRY'],
      };
    }
    const outerRings = assembleRings(
      element.members.filter((member) => member.role === 'outer').map((member) => member.geometry!),
    );
    const innerRings = assembleRings(
      element.members.filter((member) => member.role === 'inner').map((member) => member.geometry!),
    );
    if (!outerRings?.length) {
      return {
        evidence: 'unknown',
        completeness: 'invalid',
        polygons: [],
        reasons: ['UNCLOSED_OUTER'],
      };
    }
    if (innerRings === null) {
      return {
        evidence: 'unknown',
        completeness: 'invalid',
        polygons: [],
        reasons: ['UNCLOSED_INNER'],
      };
    }
    const relationPolygons = outerRings.map((outer) => ({ outer, holes: [] as LatLon[][] }));
    for (const hole of innerRings) {
      const owner = relationPolygons.find((polygon) => pointInRing(hole[0], polygon.outer));
      if (!owner) {
        return {
          evidence: 'unknown',
          completeness: 'invalid',
          polygons: [],
          reasons: ['ORPHAN_INNER'],
        };
      }
      owner.holes.push(hole);
    }
    polygons.push(...relationPolygons);
  }
  return polygons.length
    ? { evidence: 'mapped-woodland', completeness: 'complete', polygons, reasons: [] }
    : {
        evidence: 'no-mapped-woodland',
        completeness: 'complete',
        polygons: [],
        reasons: ['NO_MAPPED_WOODLAND'],
      };
}

function interpolateRoute(route: PlanningRoute, distanceM: number): LatLon {
  let index = 0;
  while (
    index < route.cumulativeDistanceM.length - 2 &&
    route.cumulativeDistanceM[index + 1] < distanceM
  ) {
    index += 1;
  }
  const start = route.cumulativeDistanceM[index];
  const end = route.cumulativeDistanceM[index + 1];
  const fraction = end > start ? Math.min(Math.max((distanceM - start) / (end - start), 0), 1) : 0;
  const a = route.part.points[index];
  const b = route.part.points[index + 1];
  return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
}

export function woodlandEvidenceForRoute(
  route: PlanningRoute,
  assembly: WoodlandEvidenceAssembly,
  source: string,
  fetchedAt: number | null,
  resolutionM = 50,
): WoodlandEvidenceProfile {
  const count = Math.floor(route.totalDistanceM / resolutionM) + 1;
  const values = Array.from({ length: count }, (_, index): WoodlandEvidenceValue => {
    if (assembly.evidence === 'unknown') return 'unknown';
    const point = interpolateRoute(route, Math.min(index * resolutionM, route.totalDistanceM));
    return assembly.polygons.some(
      (polygon) =>
        pointInRing(point, polygon.outer) &&
        !polygon.holes.some((hole) => pointInRing(point, hole)),
    )
      ? 'mapped-woodland'
      : 'no-mapped-woodland';
  });
  return {
    schemaVersion: 2,
    values,
    resolutionM,
    source,
    fetchedAt,
    parserVersion: WOODLAND_EVIDENCE_PARSER_MODEL_VERSION,
    completeness:
      assembly.completeness === 'complete'
        ? 'complete'
        : assembly.completeness === 'incomplete'
          ? 'partial'
          : 'unknown',
    confidence: assembly.completeness === 'complete' ? 1 : null,
    reasons: assembly.reasons,
  };
}
