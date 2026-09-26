/**
 * Grade-adjusted pace.
 *
 * The user's pace is their flat-ground pace; hills bend it. We use the
 * Minetti et al. (2002) energy cost of running on gradient,
 *
 *   C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6   [J/kg/m]
 *
 * with i the grade as a fraction, and assume the runner holds constant
 * metabolic power: speed multiplier = C(0)/C(i) = 3.6/C(i).
 *
 * Two clamps keep the model honest at the edges:
 *   - grade is clamped to ±30% (beyond that it's scrambling, not running,
 *     and the polynomial leaves its fitted range);
 *   - the speedup is capped at 1.10×. Minetti measures treadmill energy,
 *     but real downhill running is limited by braking and cadence, not
 *     metabolism — nobody converts a −10% grade into 60% more speed.
 */

export const MAX_GRADE = 0.3;
export const MIN_SPEED_FACTOR = 0.35; // ~3× slower on the steepest runnable climb
export const MAX_SPEED_FACTOR = 1.1;

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

/** Multiplier on flat-ground speed at a given grade (rise/run fraction). */
export function gradeSpeedFactor(grade: number): number {
  const i = clamp(grade, -MAX_GRADE, MAX_GRADE);
  const cost = ((((155.4 * i - 30.4) * i - 43.3) * i + 46.3) * i + 19.5) * i + 3.6;
  return clamp(3.6 / cost, MIN_SPEED_FACTOR, MAX_SPEED_FACTOR);
}
