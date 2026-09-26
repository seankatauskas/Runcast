import { describe, expect, it } from 'vitest';
import { parsePlanningGpx } from './gpx';
import { buildRouteTiming } from './timing';
import { playbackDistanceAtTime } from './transforms';

function northRoute(km: number, elevation: (index: number) => number = () => 0) {
  const points = Array.from(
    { length: km + 1 },
    (_, index) =>
      `<rtept lat="${41.9 + index * 0.0089932}" lon="-87.6"><ele>${elevation(index)}</ele></rtept>`,
  ).join('');
  return parsePlanningGpx(`<gpx><rte>${points}</rte></gpx>`, 'timing', 'Timing');
}

describe('current grade timing and playback', () => {
  it('covers route endpoints with bounded monotonic samples and scales with requested speed', () => {
    const route = northRoute(100);
    const fast = buildRouteTiming(route, 1000, 4);
    const slow = buildRouteTiming(route, 1000, 2);
    expect(fast.points.length).toBeLessThanOrEqual(500);
    expect(fast.points[0].distanceM).toBe(0);
    expect(fast.points.at(-1)!.distanceM).toBeCloseTo(route.totalDistanceM, 6);
    expect(slow.durationSeconds / fast.durationSeconds).toBeCloseTo(2, 6);
    for (let index = 1; index < fast.points.length; index++) {
      expect(fast.points[index].time).toBeGreaterThan(fast.points[index - 1].time);
      expect(fast.points[index].distanceM).toBeGreaterThan(fast.points[index - 1].distanceM);
    }
  });
  it('slows playback through a climb and clamps positions outside the run', () => {
    const route = northRoute(5, (index) => Math.min(index, 2.5) * 60);
    const timing = buildRouteTiming(route, 1000, 3);
    const flat = buildRouteTiming(northRoute(5), 1000, 3);
    const first = timing.points[0];
    const last = timing.points.at(-1)!;
    expect(timing.durationSeconds).toBeGreaterThan(flat.durationSeconds);
    expect(playbackDistanceAtTime(timing.points, first.time - 1000)).toBe(0);
    expect(playbackDistanceAtTime(timing.points, last.time + 1000)).toBeCloseTo(
      route.totalDistanceM,
      6,
    );
    expect(playbackDistanceAtTime(timing.points, (first.time + last.time) / 2)).toBeLessThan(
      route.totalDistanceM * 0.48,
    );
    for (const point of timing.points)
      expect(playbackDistanceAtTime(timing.points, point.time)).toBeCloseTo(point.distanceM, 6);
  });
});
