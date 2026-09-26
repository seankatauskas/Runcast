import { bearing } from '../geo';
import { MAX_SAMPLES, SAMPLE_SPACING, segmentIndexAt } from '../interpolate';
import { gradeSpeedFactor } from '../gap';
import type { PlanningRoute, ReasonCode, PlanningRoutePoint } from './types';
import { FLAT_PACE_MODEL_VERSION, GRADE_ADJUSTED_PACE_MODEL_VERSION } from './versions';

export interface RouteTimingPoint {
  distanceM: number;
  position: PlanningRoutePoint;
  bearingDeg: number;
  time: number;
  grade: number;
  speedMs: number;
}

export interface RouteTiming {
  points: RouteTimingPoint[];
  durationSeconds: number;
  finishTime: number;
  quality: 'grade-adjusted' | 'flat-fallback';
  paceModelVersion: typeof GRADE_ADJUSTED_PACE_MODEL_VERSION | typeof FLAT_PACE_MODEL_VERSION;
  reasons: ReasonCode[];
}

export function planningPositionAt(
  route: PlanningRoute,
  distanceM: number,
): {
  position: PlanningRoutePoint;
  bearingDeg: number;
} {
  const points = route.part.points;
  const cumulative = route.cumulativeDistanceM;
  const index = segmentIndexAt(cumulative, distanceM);
  const segmentLength = cumulative[index + 1] - cumulative[index];
  const fraction =
    segmentLength > 0
      ? Math.min(Math.max((distanceM - cumulative[index]) / segmentLength, 0), 1)
      : 0;
  const a = points[index];
  const b = points[index + 1];
  const elevationM =
    a.elevationM === null || b.elevationM === null
      ? null
      : a.elevationM + (b.elevationM - a.elevationM) * fraction;
  return {
    position: {
      lat: a.lat + (b.lat - a.lat) * fraction,
      lon: a.lon + (b.lon - a.lon) * fraction,
      elevationM,
    },
    bearingDeg: bearing(a, b),
  };
}

/** `expectedSpeedMs` means expected flat speed for this run. */
export function buildRouteTiming(
  route: PlanningRoute,
  startTime: number,
  expectedSpeedMs: number,
): RouteTiming {
  if (!Number.isFinite(startTime)) throw new TypeError('startTime must be finite');
  if (!Number.isFinite(expectedSpeedMs) || expectedSpeedMs <= 0) {
    throw new TypeError('expectedSpeedMs must be positive and finite');
  }
  const total = route.totalDistanceM;
  if (!Number.isFinite(total) || total <= 0) throw new TypeError('route distance must be positive');
  const intervalCount = Math.min(Math.max(Math.round(total / SAMPLE_SPACING), 1), MAX_SAMPLES - 1);
  const gap = total / intervalCount;
  const completeElevation =
    route.quality.elevationStatus === 'complete' &&
    route.part.points.every((point) => point.elevationM !== null);
  const points = new Array<RouteTimingPoint>(intervalCount + 1);
  for (let index = 0; index <= intervalCount; index += 1) {
    const distanceM = gap * index;
    const located = planningPositionAt(route, distanceM);
    points[index] = {
      distanceM,
      ...located,
      time: startTime,
      grade: 0,
      speedMs: expectedSpeedMs,
    };
  }

  if (completeElevation) {
    for (let index = 0; index < intervalCount; index += 1) {
      const lower = Math.max(index - 1, 0);
      const upper = Math.min(index + 2, intervalCount);
      const lowerElevation = points[lower].position.elevationM as number;
      const upperElevation = points[upper].position.elevationM as number;
      points[index].grade = (upperElevation - lowerElevation) / ((upper - lower) * gap);
      points[index].speedMs = expectedSpeedMs * gradeSpeedFactor(points[index].grade);
    }
    points[intervalCount].grade = points[intervalCount - 1].grade;
    points[intervalCount].speedMs = points[intervalCount - 1].speedMs;
  }

  let time = startTime;
  for (let index = 1; index <= intervalCount; index += 1) {
    time += (gap / points[index - 1].speedMs) * 1000;
    points[index].time = time;
  }
  return {
    points,
    durationSeconds: (time - startTime) / 1000,
    finishTime: time,
    quality: completeElevation ? 'grade-adjusted' : 'flat-fallback',
    paceModelVersion: completeElevation
      ? GRADE_ADJUSTED_PACE_MODEL_VERSION
      : FLAT_PACE_MODEL_VERSION,
    reasons: completeElevation
      ? []
      : [...route.quality.reasons, 'timing.flat-fallback'].filter(
          (reason, index, reasons) => reasons.indexOf(reason) === index,
        ),
  };
}
