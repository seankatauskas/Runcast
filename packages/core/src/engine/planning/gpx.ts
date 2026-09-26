import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from 'saxes';
import { cumulativeDistances } from '../geo';
import type { Route } from '../types';
import type { PlanningRoute, ReasonCode, PlanningRoutePoint } from './types';

export const GPX_MAX_UTF8_BYTES = 2 * 1024 * 1024;
export const GPX_MAX_POINTS = 20_000;
export const GPX_MAX_TOTAL_DISTANCE_M = 250_000;

export type GpxDiagnosticCode =
  | 'DTD_FORBIDDEN'
  | 'ENTITY_FORBIDDEN'
  | 'INVALID_COORDINATE'
  | 'INVALID_ELEVATION'
  | 'MALFORMED_XML'
  | 'MULTIPLE_CONTINUOUS_PARTS'
  | 'NO_PLANNABLE_ROUTE'
  | 'PAYLOAD_TOO_LARGE'
  | 'POINT_LIMIT_EXCEEDED'
  | 'ROUTE_DISTANCE_EXCEEDED';

export interface GpxDiagnostic {
  code: GpxDiagnosticCode;
  message: string;
  details?: Record<string, number | string>;
}

export class PlanningGpxParseError extends Error {
  readonly diagnostics: GpxDiagnostic[];

  constructor(diagnostic: GpxDiagnostic) {
    super(diagnostic.message);
    this.name = 'PlanningGpxParseError';
    this.diagnostics = [diagnostic];
  }

  get code(): GpxDiagnosticCode {
    return this.diagnostics[0].code;
  }
}

interface ParsedPoint extends PlanningRoutePoint {
  elevationText: string | null;
}

function failure(
  code: GpxDiagnosticCode,
  message: string,
  details?: Record<string, number | string>,
): never {
  throw new PlanningGpxParseError({ code, message, details });
}

function attribute(tag: SaxesTagNS, local: string): string | undefined {
  return Object.values(tag.attributes).find(
    (value: SaxesAttributeNS) => value.local === local && value.prefix === '',
  )?.value;
}

function continuousPartFailure(
  trackCount: number,
  segmentCount: number,
  routeCount: number,
): never {
  return failure(
    'MULTIPLE_CONTINUOUS_PARTS',
    'GPX must contain exactly one continuous track segment or one route-point sequence.',
    { trackCount, segmentCount, routeCount },
  );
}

/** Namespace-aware, bounded GPX parsing shared by guest and authenticated imports. */
export function parsePlanningGpx(xml: string, id: string, fallbackName: string): PlanningRoute {
  const byteLength = new TextEncoder().encode(xml).byteLength;
  if (byteLength > GPX_MAX_UTF8_BYTES) {
    return failure('PAYLOAD_TOO_LARGE', 'GPX payload exceeds the 2 MiB UTF-8 limit.', {
      byteLength,
      limit: GPX_MAX_UTF8_BYTES,
    });
  }
  if (/<!\s*ENTITY\b[^>]*\b(?:SYSTEM|PUBLIC)\b/i.test(xml)) {
    return failure('ENTITY_FORBIDDEN', 'GPX external entity declarations are forbidden.');
  }
  if (/<!\s*DOCTYPE\b/i.test(xml)) {
    return failure('DTD_FORBIDDEN', 'GPX document type declarations are forbidden.');
  }
  if (/<!\s*ENTITY\b/i.test(xml)) {
    return failure('ENTITY_FORBIDDEN', 'GPX entity declarations are forbidden.');
  }
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(xml)) {
    return failure('ENTITY_FORBIDDEN', 'GPX general entity references are forbidden.');
  }

  let rootIsGpx = false;
  let trackCount = 0;
  let segmentCount = 0;
  let routeCount = 0;
  let waypointCount = 0;
  let rawPointCount = 0;
  const trackPoints: ParsedPoint[] = [];
  const routePoints: ParsedPoint[] = [];
  const stack: string[] = [];
  let currentPoint: ParsedPoint | null = null;
  let currentPointKind: 'track' | 'route' | null = null;
  let text = '';
  let textKind: 'elevation' | 'name' | null = null;
  let nameContext: 'track' | 'route' | 'metadata' | null = null;
  let trackName: string | null = null;
  let routeName: string | null = null;
  let metadataName: string | null = null;
  let parserError: Error | null = null;

  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    failure('DTD_FORBIDDEN', 'GPX document type declarations are forbidden.');
  });
  parser.on('error', (error) => {
    parserError = error;
  });
  parser.on('opentag', (tag) => {
    const local = tag.local.toLowerCase();
    if (stack.length === 0) rootIsGpx = local === 'gpx';
    if (local === 'trk') trackCount += 1;
    if (local === 'trkseg' && stack.includes('trk')) segmentCount += 1;
    if (local === 'rte') routeCount += 1;
    if (local === 'wpt') waypointCount += 1;

    if (local === 'trkpt' || local === 'rtept') {
      rawPointCount += 1;
      if (rawPointCount > GPX_MAX_POINTS) {
        failure('POINT_LIMIT_EXCEEDED', 'GPX point count exceeds 20,000.', {
          pointCount: rawPointCount,
          limit: GPX_MAX_POINTS,
        });
      }
      const kind = local === 'trkpt' ? 'track' : 'route';
      const inExpectedParent = kind === 'track' ? stack.includes('trkseg') : stack.includes('rte');
      if (inExpectedParent) {
        const lat = Number(attribute(tag, 'lat'));
        const lon = Number(attribute(tag, 'lon'));
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          lat < -90 ||
          lat > 90 ||
          lon < -180 ||
          lon > 180
        ) {
          failure('INVALID_COORDINATE', 'GPX contains an invalid or out-of-range coordinate.', {
            point: rawPointCount,
          });
        }
        currentPoint = { lat, lon, elevationM: null, elevationText: null };
        currentPointKind = kind;
      }
    } else if (local === 'ele' && currentPoint) {
      textKind = 'elevation';
      text = '';
    } else if (local === 'name') {
      if (stack.includes('trk')) nameContext = 'track';
      else if (stack.includes('rte')) nameContext = 'route';
      else if (stack.includes('metadata')) nameContext = 'metadata';
      if (nameContext) {
        textKind = 'name';
        text = '';
      }
    }
    stack.push(local);
  });
  parser.on('text', (value) => {
    if (textKind) text += value;
  });
  parser.on('cdata', (value) => {
    if (textKind) text += value;
  });
  parser.on('closetag', (tag) => {
    const local = tag.local.toLowerCase();
    if (local === 'ele' && currentPoint && textKind === 'elevation') {
      const trimmed = text.trim();
      const elevation = Number(trimmed);
      if (!trimmed || !Number.isFinite(elevation)) {
        failure('INVALID_ELEVATION', 'GPX contains a non-numeric elevation value.', {
          point: rawPointCount,
        });
      }
      currentPoint.elevationM = elevation;
      currentPoint.elevationText = trimmed;
      textKind = null;
      text = '';
    } else if (local === 'name' && textKind === 'name') {
      const value = text.trim();
      if (value) {
        if (nameContext === 'track' && trackName === null) trackName = value;
        if (nameContext === 'route' && routeName === null) routeName = value;
        if (nameContext === 'metadata' && metadataName === null) metadataName = value;
      }
      textKind = null;
      nameContext = null;
      text = '';
    } else if ((local === 'trkpt' || local === 'rtept') && currentPoint) {
      const { elevationText: _elevationText, ...point } = currentPoint;
      if (currentPointKind === 'track') trackPoints.push({ ...point, elevationText: null });
      if (currentPointKind === 'route') routePoints.push({ ...point, elevationText: null });
      currentPoint = null;
      currentPointKind = null;
    }
    stack.pop();
  });

  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof PlanningGpxParseError) throw error;
    parserError = error instanceof Error ? error : new Error('Malformed XML');
  }
  if (parserError) {
    return failure('MALFORMED_XML', 'GPX is not well-formed XML.', {
      parserMessage: parserError.message.slice(0, 160),
    });
  }
  if (!rootIsGpx) return failure('MALFORMED_XML', 'Document root must be <gpx>.');

  const useTrack = trackCount > 0;
  if (
    (useTrack && (trackCount !== 1 || segmentCount !== 1 || routeCount !== 0)) ||
    (!useTrack && routeCount !== 1)
  ) {
    if (trackCount > 0 || routeCount > 0) {
      return continuousPartFailure(trackCount, segmentCount, routeCount);
    }
  }
  const selected = useTrack ? trackPoints : routePoints;
  if (selected.length < 2) {
    return failure(
      'NO_PLANNABLE_ROUTE',
      waypointCount > 0
        ? 'Waypoint-only GPX files are not plannable routes.'
        : 'GPX needs at least two points in one continuous part.',
      { waypointCount, pointCount: selected.length },
    );
  }

  const points: PlanningRoutePoint[] = [];
  let duplicatePointCount = 0;
  for (const point of selected) {
    const previous = points.at(-1);
    if (
      previous &&
      previous.lat === point.lat &&
      previous.lon === point.lon &&
      previous.elevationM === point.elevationM
    ) {
      duplicatePointCount += 1;
      continue;
    }
    points.push({ lat: point.lat, lon: point.lon, elevationM: point.elevationM });
  }
  if (points.length < 2) {
    return failure('NO_PLANNABLE_ROUTE', 'GPX has fewer than two distinct consecutive points.');
  }

  const missingElevationCount = points.filter((point) => point.elevationM === null).length;
  const elevationStatus =
    missingElevationCount === 0
      ? 'complete'
      : missingElevationCount === points.length
        ? 'absent'
        : 'partial';
  const reasons: ReasonCode[] = [];
  if (duplicatePointCount) reasons.push('route.duplicate-point-removed');
  if (elevationStatus === 'absent') reasons.push('route.elevation-absent');
  if (elevationStatus === 'partial') reasons.push('route.elevation-partial');
  const cumulativeDistanceM = cumulativeDistances(points);
  const totalDistanceM = cumulativeDistanceM.at(-1) ?? 0;
  if (!(totalDistanceM > 0)) {
    return failure('NO_PLANNABLE_ROUTE', 'GPX route must have positive distance.');
  }
  if (totalDistanceM > GPX_MAX_TOTAL_DISTANCE_M) {
    return failure('ROUTE_DISTANCE_EXCEEDED', 'GPX route exceeds the supported distance.', {
      distanceM: Math.round(totalDistanceM),
      limitM: GPX_MAX_TOTAL_DISTANCE_M,
    });
  }

  return {
    schemaVersion: 2,
    id,
    name: trackName ?? routeName ?? metadataName ?? fallbackName,
    part: { points },
    cumulativeDistanceM,
    totalDistanceM,
    quality: {
      schemaVersion: 2,
      trackCount,
      trackSegmentCount: segmentCount,
      routeCount,
      invalidPointCount: 0,
      duplicatePointCount,
      missingElevationCount,
      elevationStatus,
      reasons,
    },
  };
}

/** Legacy routes have ambiguous zero elevation, so the planning engine evaluates them flat. */
export function adaptLegacyRoute(route: Route): PlanningRoute {
  return {
    schemaVersion: 2,
    id: route.id,
    name: route.name,
    part: {
      points: route.points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        elevationM: point.ele,
      })),
    },
    cumulativeDistanceM: [...route.cumulative],
    totalDistanceM: route.totalDistance,
    quality: {
      schemaVersion: 2,
      trackCount: 0,
      trackSegmentCount: 0,
      routeCount: 0,
      invalidPointCount: 0,
      duplicatePointCount: 0,
      missingElevationCount: 0,
      elevationStatus: 'legacy-unknown',
      reasons: ['route.elevation-legacy-unknown', 'timing.flat-fallback'],
    },
  };
}
