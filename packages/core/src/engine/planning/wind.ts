import { normalizeBearing, toDeg, toRad } from '../geo';

export interface RunnerRelativeWindInput {
  ambientSpeedMs: number;
  meteorologicalFromDeg: number;
  runnerBearingDeg: number;
  runnerSpeedMs: number;
}

export interface WindVector2 {
  eastMs: number;
  northMs: number;
}

export interface RunnerRelativeWind {
  ambient: {
    vector: WindVector2;
    speedMs: number;
    meteorologicalFromDeg: number;
    /** Positive is ambient opposition; negative is ambient assistance. */
    alongTrackMs: number;
    /** Signed left-of-track component. */
    crossTrackMs: number;
  };
  runnerVelocity: WindVector2;
  apparentAirflow: {
    vector: WindVector2;
    speedMs: number;
    /** Signed world-flow component along travel; negative opposes the runner. */
    alongTrackMs: number;
    /** Signed left-of-track component. */
    crossTrackMs: number;
    meteorologicalFromDeg: number;
  };
  /** Transparent proportional quantity, not calibrated energy expenditure. */
  aerodynamicOppositionDelta: number;
}

function requireNonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be nonnegative`);
}

export function runnerRelativeWind(input: RunnerRelativeWindInput): RunnerRelativeWind {
  requireNonnegative(input.ambientSpeedMs, 'ambientSpeedMs');
  requireNonnegative(input.runnerSpeedMs, 'runnerSpeedMs');
  if (!Number.isFinite(input.meteorologicalFromDeg) || !Number.isFinite(input.runnerBearingDeg)) {
    throw new TypeError('wind direction and runner bearing must be finite');
  }
  const flowDirection = toRad(input.meteorologicalFromDeg + 180);
  const ambient = {
    eastMs: Math.sin(flowDirection) * input.ambientSpeedMs,
    northMs: Math.cos(flowDirection) * input.ambientSpeedMs,
  };
  const bearing = toRad(input.runnerBearingDeg);
  const heading = { east: Math.sin(bearing), north: Math.cos(bearing) };
  const left = { east: -Math.cos(bearing), north: Math.sin(bearing) };
  const runnerVelocity = {
    eastMs: heading.east * input.runnerSpeedMs,
    northMs: heading.north * input.runnerSpeedMs,
  };
  const apparent = {
    eastMs: ambient.eastMs - runnerVelocity.eastMs,
    northMs: ambient.northMs - runnerVelocity.northMs,
  };
  const apparentSpeedMs = Math.hypot(apparent.eastMs, apparent.northMs);
  const apparentAlongTrackMs = apparent.eastMs * heading.east + apparent.northMs * heading.north;
  const apparentCrossTrackMs = apparent.eastMs * left.east + apparent.northMs * left.north;
  const ambientFlowAlong = ambient.eastMs * heading.east + ambient.northMs * heading.north;
  const ambientCrossTrackMs = ambient.eastMs * left.east + ambient.northMs * left.north;
  const apparentTowards =
    apparentSpeedMs < 1e-9
      ? normalizeBearing(input.runnerBearingDeg)
      : normalizeBearing(toDeg(Math.atan2(apparent.eastMs, apparent.northMs)));

  return {
    ambient: {
      vector: ambient,
      speedMs: input.ambientSpeedMs,
      meteorologicalFromDeg: normalizeBearing(input.meteorologicalFromDeg),
      alongTrackMs: -ambientFlowAlong,
      crossTrackMs: ambientCrossTrackMs,
    },
    runnerVelocity,
    apparentAirflow: {
      vector: apparent,
      speedMs: apparentSpeedMs,
      alongTrackMs: apparentAlongTrackMs,
      crossTrackMs: apparentCrossTrackMs,
      meteorologicalFromDeg: normalizeBearing(apparentTowards + 180),
    },
    aerodynamicOppositionDelta: -apparentSpeedMs * apparentAlongTrackMs - input.runnerSpeedMs ** 2,
  };
}
