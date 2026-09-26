import { describe, expect, it } from 'vitest';
import { coordinatesWithinMeters, thumbnailCameraForRoute } from './mapGeometry';

describe('coordinatesWithinMeters', () => {
  it('recognizes a route whose recorded endpoints close within a city block', () => {
    const start = { lat: 40.785091, lon: -73.968285 };
    const nearFinish = { lat: 40.78542, lon: -73.968285 };
    expect(coordinatesWithinMeters(start, nearFinish, 65)).toBe(true);
  });

  it('keeps point-to-point route endpoints distinct', () => {
    const start = { lat: 40.785091, lon: -73.968285 };
    const finish = { lat: 40.7923, lon: -73.958 };
    expect(coordinatesWithinMeters(start, finish, 65)).toBe(false);
  });
});

describe('thumbnailCameraForRoute', () => {
  it('frames a tall city route tightly inside a short preview', () => {
    const points = [
      { lat: 40.764, lon: -73.981 },
      { lat: 40.782, lon: -73.958 },
      { lat: 40.8, lon: -73.949 },
    ];
    const camera = thumbnailCameraForRoute(points, 340, 112);

    expect(camera).not.toBeNull();
    expect(camera?.center[0]).toBeCloseTo(-73.965);
    expect(camera?.center[1]).toBeGreaterThan(40.78);

    const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const routeHeightAtZoom =
      512 *
      ((mercatorY(points[2].lat) - mercatorY(points[0].lat)) / (2 * Math.PI)) *
      2 ** camera!.zoom;
    expect(routeHeightAtZoom).toBeGreaterThan(84);
    expect(routeHeightAtZoom).toBeLessThan(92);
  });

  it('leaves endpoint-badge breathing room in a map-first preview', () => {
    const points = [
      { lat: 37.79, lon: -122.49 },
      { lat: 37.805, lon: -122.485 },
      { lat: 37.83, lon: -122.48 },
    ];
    const camera = thumbnailCameraForRoute(points, 340, 176);

    const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const routeHeightAtZoom =
      512 *
      ((mercatorY(points[2].lat) - mercatorY(points[0].lat)) / (2 * Math.PI)) *
      2 ** camera!.zoom;

    expect(routeHeightAtZoom).toBeGreaterThan(138);
    expect(routeHeightAtZoom).toBeLessThan(146);
  });

  it('does not create a camera before the preview has route geometry', () => {
    expect(thumbnailCameraForRoute([], 340, 112)).toBeNull();
    expect(thumbnailCameraForRoute([{ lat: 40.78, lon: -73.96 }], 0, 112)).toBeNull();
  });
});
