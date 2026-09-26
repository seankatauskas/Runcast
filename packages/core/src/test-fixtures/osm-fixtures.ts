/** Test-only Overpass `out geom` fixtures for woodland evidence assembly. */

export interface OsmFixturePoint {
  lat: number;
  lon: number;
}

export interface OsmWayFixture {
  type: 'way';
  id: number;
  geometry: OsmFixturePoint[];
  tags?: Record<string, string>;
}

export interface OsmRelationMemberFixture {
  type: 'way';
  ref: number;
  role: 'outer' | 'inner' | string;
  geometry?: OsmFixturePoint[];
}

export interface OsmRelationFixture {
  type: 'relation';
  id: number;
  members: OsmRelationMemberFixture[];
  tags?: Record<string, string>;
}

export type OsmElementFixture = OsmWayFixture | OsmRelationFixture;

export interface OverpassPayloadFixture {
  version: number;
  generator: string;
  osm3s?: { timestamp_osm_base: string; copyright: string };
  elements: OsmElementFixture[];
  remark?: string;
}

export interface OsmEvidenceFixture {
  description: string;
  response: OverpassPayloadFixture;
  expected: {
    evidence: 'mapped-woodland' | 'no-mapped-woodland' | 'unknown';
    polygonCount: number;
    holeCount: number;
    completeness: 'complete' | 'incomplete' | 'invalid';
    reasons: string[];
  };
}

const a: OsmFixturePoint = { lat: 41.9, lon: -87.6 };
const b: OsmFixturePoint = { lat: 41.9, lon: -87.59 };
const c: OsmFixturePoint = { lat: 41.91, lon: -87.59 };
const d: OsmFixturePoint = { lat: 41.91, lon: -87.6 };
const e: OsmFixturePoint = { lat: 41.92, lon: -87.58 };
const f: OsmFixturePoint = { lat: 41.92, lon: -87.57 };
const g: OsmFixturePoint = { lat: 41.93, lon: -87.57 };
const h: OsmFixturePoint = { lat: 41.93, lon: -87.58 };

function response(elements: OsmElementFixture[], remark?: string): OverpassPayloadFixture {
  return {
    version: 0.6,
    generator: 'Overpass API fixture',
    osm3s: {
      timestamp_osm_base: '2026-07-18T12:00:00Z',
      copyright: 'OpenStreetMap contributors',
    },
    elements,
    ...(remark === undefined ? {} : { remark }),
  };
}

function relation(
  id: number,
  members: OsmRelationMemberFixture[],
  tags: Record<string, string> = { type: 'multipolygon', natural: 'wood' },
): OsmRelationFixture {
  return { type: 'relation', id, members, tags };
}

export const osmEvidenceFixtures = {
  closedWoodlandWay: {
    description: 'a complete closed tagged way is mapped woodland evidence',
    response: response([
      { type: 'way', id: 1, geometry: [a, b, c, d, a], tags: { natural: 'wood' } },
    ]),
    expected: {
      evidence: 'mapped-woodland',
      polygonCount: 1,
      holeCount: 0,
      completeness: 'complete',
      reasons: [],
    },
  },
  disjointOuterRelation: {
    description: 'one relation can contain multiple disjoint outer polygons',
    response: response([
      relation(10, [
        { type: 'way', ref: 101, role: 'outer', geometry: [a, b, c, d, a] },
        { type: 'way', ref: 102, role: 'outer', geometry: [e, f, g, h, e] },
      ]),
    ]),
    expected: {
      evidence: 'mapped-woodland',
      polygonCount: 2,
      holeCount: 0,
      completeness: 'complete',
      reasons: [],
    },
  },
  relationWithInnerHole: {
    description: 'an inner clearing remains outside woodland evidence',
    response: response([
      relation(11, [
        { type: 'way', ref: 111, role: 'outer', geometry: [a, b, c, d, a] },
        {
          type: 'way',
          ref: 112,
          role: 'inner',
          geometry: [
            { lat: 41.903, lon: -87.597 },
            { lat: 41.903, lon: -87.593 },
            { lat: 41.907, lon: -87.593 },
            { lat: 41.907, lon: -87.597 },
            { lat: 41.903, lon: -87.597 },
          ],
        },
      ]),
    ]),
    expected: {
      evidence: 'mapped-woodland',
      polygonCount: 1,
      holeCount: 1,
      completeness: 'complete',
      reasons: [],
    },
  },
  reversedSplitMembers: {
    description: 'split outer ways assemble despite reversed directions and shuffled member order',
    response: response([
      relation(12, [
        { type: 'way', ref: 123, role: 'outer', geometry: [d, c] },
        { type: 'way', ref: 121, role: 'outer', geometry: [b, a] },
        { type: 'way', ref: 124, role: 'outer', geometry: [a, d] },
        { type: 'way', ref: 122, role: 'outer', geometry: [c, b] },
      ]),
    ]),
    expected: {
      evidence: 'mapped-woodland',
      polygonCount: 1,
      holeCount: 0,
      completeness: 'complete',
      reasons: [],
    },
  },
  relationTagsOnly: {
    description: 'woodland tags may be on the relation rather than member ways',
    response: response([
      relation(13, [
        { type: 'way', ref: 131, role: 'outer', geometry: [a, b, c] },
        { type: 'way', ref: 132, role: 'outer', geometry: [c, d, a] },
      ]),
    ]),
    expected: {
      evidence: 'mapped-woodland',
      polygonCount: 1,
      holeCount: 0,
      completeness: 'complete',
      reasons: [],
    },
  },
  malformedUnclosedRelation: {
    description: 'an unclosed outer is unknown, never confidently open',
    response: response([
      relation(14, [
        { type: 'way', ref: 141, role: 'outer', geometry: [a, b, c] },
        { type: 'way', ref: 142, role: 'outer', geometry: [d, a] },
      ]),
    ]),
    expected: {
      evidence: 'unknown',
      polygonCount: 0,
      holeCount: 0,
      completeness: 'invalid',
      reasons: ['UNCLOSED_OUTER'],
    },
  },
  missingMemberGeometry: {
    description: 'a partial relation response cannot prove either woodland or absence',
    response: response([
      relation(15, [
        { type: 'way', ref: 151, role: 'outer', geometry: [a, b, c] },
        { type: 'way', ref: 152, role: 'outer' },
      ]),
    ]),
    expected: {
      evidence: 'unknown',
      polygonCount: 0,
      holeCount: 0,
      completeness: 'incomplete',
      reasons: ['MISSING_MEMBER_GEOMETRY'],
    },
  },
  timeoutLikePartialResponse: {
    description: 'HTTP-success-shaped payloads carrying a timeout remark remain unknown',
    response: response([], 'runtime error: Query timed out in "query" at line 1'),
    expected: {
      evidence: 'unknown',
      polygonCount: 0,
      holeCount: 0,
      completeness: 'incomplete',
      reasons: ['PROVIDER_PARTIAL_RESPONSE'],
    },
  },
  completeEmptyResponse: {
    description: 'a proven complete empty parse means no mapped woodland evidence, not open canopy',
    response: response([]),
    expected: {
      evidence: 'no-mapped-woodland',
      polygonCount: 0,
      holeCount: 0,
      completeness: 'complete',
      reasons: ['NO_MAPPED_WOODLAND'],
    },
  },
} as const satisfies Record<string, OsmEvidenceFixture>;
