import { describe, expect, it } from 'vitest';
import { GpxParseError, parseGpx } from './gpx';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Morning Loop</name>
    <trkseg>
      <trkpt lat="41.9633" lon="-87.6381"><ele>180.2</ele></trkpt>
      <trkpt lat="41.9540" lon="-87.6390"><ele>181.0</ele></trkpt>
      <trkpt lat="41.9450" lon="-87.6402"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('parseGpx', () => {
  it('extracts points, elevation, name, and distances', () => {
    const route = parseGpx(GPX, 'r1', 'Fallback');
    expect(route.name).toBe('Morning Loop');
    expect(route.points).toHaveLength(3);
    expect(route.points[0]).toEqual({
      lat: 41.9633,
      lon: -87.6381,
      ele: 180.2,
    });
    expect(route.points[2].ele).toBe(0); // missing <ele> defaults to 0
    expect(route.cumulative[0]).toBe(0);
    expect(route.totalDistance).toBeGreaterThan(1800); // ~2 km of latitude
    expect(route.totalDistance).toBeLessThan(2300);
  });

  it('uses the fallback name when the GPX has none', () => {
    const route = parseGpx(GPX.replace('<name>Morning Loop</name>', ''), 'r1', 'My Upload');
    expect(route.name).toBe('My Upload');
  });

  it('rejects non-XML', () => {
    expect(() => parseGpx('not xml at all {', 'r1', 'x')).toThrow(GpxParseError);
  });

  it('rejects tracks with fewer than two points', () => {
    const one = `<gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(one, 'r1', 'x')).toThrow(GpxParseError);
  });
});
