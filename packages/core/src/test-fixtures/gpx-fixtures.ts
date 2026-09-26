/** Test-only GPX source fixtures. These model import intent, not V1 parser behavior. */

export const GPX_MAX_UTF8_BYTES = 2 * 1024 * 1024;
export const GPX_MAX_POINTS = 20_000;

export type GpxFixtureExpectation =
  | {
      outcome: 'accepted';
      pointCount: number;
      elevationStatus: 'complete' | 'partial' | 'absent';
      duplicateCount?: number;
      sourceKind?: 'track' | 'route';
    }
  | {
      outcome: 'rejected';
      reason:
        | 'DTD_FORBIDDEN'
        | 'ENTITY_FORBIDDEN'
        | 'INVALID_COORDINATE'
        | 'MALFORMED_XML'
        | 'MULTIPLE_CONTINUOUS_PARTS'
        | 'NO_PLANNABLE_ROUTE';
    };

export interface GpxSourceFixture {
  description: string;
  xml: string;
  expected: GpxFixtureExpectation;
}

export interface StravaExportResponseFixture {
  status: 200;
  headers: { contentType: 'application/gpx+xml'; contentLength: number | null };
  /** Response chunks allow API tests to prove the byte limit is enforced while streaming. */
  chunks: string[];
  expected: {
    outcome: 'accepted' | 'rejected';
    reason?: 'PAYLOAD_TOO_LARGE' | 'POINT_LIMIT_EXCEEDED';
  };
}

const header =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<gpx version="1.1" creator="runcast-fixture" xmlns="http://www.topografix.com/GPX/1/1">';
const footer = '</gpx>';

function track(segmentBody: string, name = 'Fixture route'): string {
  return `${header}<trk><name>${name}</name><trkseg>${segmentBody}</trkseg></trk>${footer}`;
}

function point(lat: number, lon: number, elevation?: number): string {
  const ele = elevation === undefined ? '' : `<ele>${elevation}</ele>`;
  return `<trkpt lat="${lat}" lon="${lon}">${ele}</trkpt>`;
}

const completePoints =
  point(41.9, -87.6, 180) + point(41.901, -87.6, 181) + point(41.902, -87.6, 182);

export const gpxSourceFixtures = {
  singleTrackCompleteElevation: {
    description: 'one track and one continuous segment with complete elevation',
    xml: track(completePoints),
    expected: { outcome: 'accepted', pointCount: 3, elevationStatus: 'complete' },
  },
  missingElevation: {
    description: 'all elevation elements are absent and must remain null',
    xml: track(point(41.9, -87.6) + point(41.901, -87.6)),
    expected: { outcome: 'accepted', pointCount: 2, elevationStatus: 'absent' },
  },
  partialElevation: {
    description: 'an elevation gap between real values must not become sea level',
    xml: track(point(41.9, -87.6, 180) + point(41.901, -87.6) + point(41.902, -87.6, 181)),
    expected: { outcome: 'accepted', pointCount: 3, elevationStatus: 'partial' },
  },
  seaLevelElevation: {
    description: 'numeric zero is valid measured elevation and is not a missing-value sentinel',
    xml: track(point(29.95, -90.07, 0) + point(29.951, -90.07, 0)),
    expected: { outcome: 'accepted', pointCount: 2, elevationStatus: 'complete' },
  },
  prefixedNamespace: {
    description: 'namespace-aware parsing accepts a prefixed GPX document',
    xml:
      '<?xml version="1.0"?><g:gpx xmlns:g="http://www.topografix.com/GPX/1/1" version="1.1" creator="fixture">' +
      '<g:trk><g:name>Namespaced &amp; valid</g:name><g:trkseg>' +
      '<g:trkpt lat="41.9" lon="-87.6"><g:ele>180</g:ele></g:trkpt>' +
      '<g:trkpt lat="41.901" lon="-87.6"><g:ele>181</g:ele></g:trkpt>' +
      '</g:trkseg></g:trk></g:gpx>',
    expected: { outcome: 'accepted', pointCount: 2, elevationStatus: 'complete' },
  },
  routePointSequence: {
    description: 'a single route-point sequence is a valid continuous route source',
    xml: `${header}<rte><rtept lat="41.9" lon="-87.6"><ele>180</ele></rtept><rtept lat="41.901" lon="-87.6"><ele>181</ele></rtept></rte>${footer}`,
    expected: {
      outcome: 'accepted',
      pointCount: 2,
      elevationStatus: 'complete',
      sourceKind: 'route',
    },
  },
  exactConsecutiveDuplicate: {
    description: 'an exact consecutive duplicate may be removed only with a diagnostic',
    xml: track(point(41.9, -87.6, 180) + point(41.9, -87.6, 180) + point(41.901, -87.6, 181)),
    expected: {
      outcome: 'accepted',
      pointCount: 2,
      elevationStatus: 'complete',
      duplicateCount: 1,
    },
  },
  multipleTracks: {
    description:
      'two tracks are two continuous parts and must never be bridged or selected silently',
    xml: `${header}<trk><trkseg>${completePoints}</trkseg></trk><trk><trkseg>${completePoints}</trkseg></trk>${footer}`,
    expected: { outcome: 'rejected', reason: 'MULTIPLE_CONTINUOUS_PARTS' },
  },
  multipleSegments: {
    description:
      'two non-empty track segments are discontinuous even when their endpoints are close',
    xml: `${header}<trk><trkseg>${point(41.9, -87.6, 180)}${point(41.901, -87.6, 181)}</trkseg><trkseg>${point(41.902, -87.6, 182)}${point(41.903, -87.6, 183)}</trkseg></trk>${footer}`,
    expected: { outcome: 'rejected', reason: 'MULTIPLE_CONTINUOUS_PARTS' },
  },
  waypointOnly: {
    description: 'waypoints are points of interest, not an ordered runnable route',
    xml: `${header}<wpt lat="41.9" lon="-87.6"/><wpt lat="41.901" lon="-87.6"/>${footer}`,
    expected: { outcome: 'rejected', reason: 'NO_PLANNABLE_ROUTE' },
  },
  invalidLatitude: {
    description: 'latitude outside [-90, 90] is invalid',
    xml: track(point(91, -87.6, 180) + point(41.901, -87.6, 181)),
    expected: { outcome: 'rejected', reason: 'INVALID_COORDINATE' },
  },
  invalidLongitude: {
    description: 'longitude outside [-180, 180] is invalid',
    xml: track(point(41.9, -181, 180) + point(41.901, -87.6, 181)),
    expected: { outcome: 'rejected', reason: 'INVALID_COORDINATE' },
  },
  malformedXml: {
    description: 'mismatched nesting cannot be repaired or partially imported',
    xml: `${header}<trk><trkseg><trkpt lat="41.9" lon="-87.6"></trkseg></trk>${footer}`,
    expected: { outcome: 'rejected', reason: 'MALFORMED_XML' },
  },
  internalEntity: {
    description: 'general entities are forbidden even when defined internally',
    xml:
      '<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY elevation "180">]>' +
      '<gpx><trk><trkseg><trkpt lat="41.9" lon="-87.6"><ele>&elevation;</ele></trkpt>' +
      '<trkpt lat="41.901" lon="-87.6"><ele>181</ele></trkpt></trkseg></trk></gpx>',
    expected: { outcome: 'rejected', reason: 'DTD_FORBIDDEN' },
  },
  externalEntity: {
    description: 'external entity declarations must never trigger file or network access',
    xml:
      '<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
      '<gpx><trk><trkseg><trkpt lat="41.9" lon="-87.6"><ele>&xxe;</ele></trkpt>' +
      '<trkpt lat="41.901" lon="-87.6"><ele>181</ele></trkpt></trkseg></trk></gpx>',
    expected: { outcome: 'rejected', reason: 'ENTITY_FORBIDDEN' },
  },
} as const satisfies Record<string, GpxSourceFixture>;

/** Builds an ASCII-only GPX document with exactly `pointCount` track points. */
export function buildPointCountGpx(pointCount: number): string {
  if (!Number.isInteger(pointCount) || pointCount < 0) {
    throw new RangeError('pointCount must be a non-negative integer');
  }
  const points = Array.from({ length: pointCount }, (_, index) => {
    const lat = 41 + (index % 10_000) / 100_000;
    return point(lat, -87.6, index % 250);
  }).join('');
  return track(points, `${pointCount} points`);
}

/** Builds a valid, ASCII-only two-point GPX document of exactly `targetBytes` UTF-8 bytes. */
export function buildUtf8SizedGpx(targetBytes: number): string {
  if (!Number.isInteger(targetBytes) || targetBytes < 0) {
    throw new RangeError('targetBytes must be a non-negative integer');
  }
  const marker = '<extensions><fixture-padding></fixture-padding></extensions>';
  const base = track(point(41.9, -87.6, 180) + point(41.901, -87.6, 181)).replace(
    footer,
    `${marker}${footer}`,
  );
  const currentBytes = new TextEncoder().encode(base).byteLength;
  if (targetBytes < currentBytes) {
    throw new RangeError(`targetBytes must be at least ${currentBytes}`);
  }
  const padding = 'x'.repeat(targetBytes - currentBytes);
  return base.replace('</fixture-padding>', `${padding}</fixture-padding>`);
}

/** Builds a bounded, chunked Strava GPX export response at a byte or point boundary. */
export function buildStravaExportResponseFixture(options: {
  byteCount?: number;
  pointCount?: number;
  includeContentLength?: boolean;
  chunkBytes?: number;
}): StravaExportResponseFixture {
  const hasByteCount = options.byteCount !== undefined;
  const hasPointCount = options.pointCount !== undefined;
  if (hasByteCount === hasPointCount) {
    throw new RangeError('provide exactly one of byteCount or pointCount');
  }
  const body = hasByteCount
    ? buildUtf8SizedGpx(options.byteCount!)
    : buildPointCountGpx(options.pointCount!);
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new RangeError('chunkBytes must be a positive integer');
  }
  // Fixture documents are ASCII-only, so character and UTF-8 byte boundaries coincide.
  const chunks = Array.from({ length: Math.ceil(bodyBytes / chunkBytes) }, (_, index) =>
    body.slice(index * chunkBytes, (index + 1) * chunkBytes),
  );
  const tooManyBytes = bodyBytes > GPX_MAX_UTF8_BYTES;
  const tooManyPoints = (options.pointCount ?? 0) > GPX_MAX_POINTS;
  return {
    status: 200,
    headers: {
      contentType: 'application/gpx+xml',
      contentLength: options.includeContentLength === false ? null : bodyBytes,
    },
    chunks,
    expected: tooManyBytes
      ? { outcome: 'rejected', reason: 'PAYLOAD_TOO_LARGE' }
      : tooManyPoints
        ? { outcome: 'rejected', reason: 'POINT_LIMIT_EXCEEDED' }
        : { outcome: 'accepted' },
  };
}
