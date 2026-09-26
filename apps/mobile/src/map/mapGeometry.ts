const EARTH_RADIUS_M = 6_371_000;

export interface MapCoordinate {
  lat: number;
  lon: number;
}

export interface ThumbnailCamera {
  center: [number, number];
  zoom: number;
}

const TILE_SIZE = 512;
const THUMBNAIL_PADDING = 18;
const TALL_THUMBNAIL_PADDING = 26;
const THUMBNAIL_ZOOM_BIAS = 0.2;

/** Frames the route tightly for a compact, north-up preview rather than a regional overview. */
export function thumbnailCameraForRoute(
  points: readonly MapCoordinate[],
  width: number,
  height: number,
): ThumbnailCamera | null {
  if (points.length === 0 || width <= 0 || height <= 0) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of points) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }

  const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const dx = Math.max((east - west) / 360, 1e-9);
  const dy = Math.max((mercatorY(north) - mercatorY(south)) / (2 * Math.PI), 1e-9);
  // Taller, map-first previews have room to protect endpoint badges from the
  // crop while the compact route-library thumbnail keeps its tighter frame.
  const padding = height >= 160 ? TALL_THUMBNAIL_PADDING : THUMBNAIL_PADDING;
  const availableWidth = Math.max(width - padding * 2, 50);
  const availableHeight = Math.max(height - padding * 2, 50);
  const fitZoom = Math.min(
    Math.log2(availableWidth / TILE_SIZE / dx),
    Math.log2(availableHeight / TILE_SIZE / dy),
    16,
  );
  const centerY = (mercatorY(north) + mercatorY(south)) / 2;
  const centerLat = ((2 * Math.atan(Math.exp(centerY)) - Math.PI / 2) * 180) / Math.PI;

  return {
    center: [(west + east) / 2, centerLat],
    zoom: fitZoom + THUMBNAIL_ZOOM_BIAS,
  };
}

export function coordinatesWithinMeters(
  a: MapCoordinate,
  b: MapCoordinate,
  thresholdM: number,
): boolean {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distance = EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return distance <= thresholdM;
}
