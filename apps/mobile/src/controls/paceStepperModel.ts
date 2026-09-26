export const MIN_PACE_SECONDS = 150;
export const MAX_PACE_SECONDS = 720;
export const PACE_STEP_SECONDS = 5;
export const PACE_COMMIT_DELAY_MS = 250;

export function nudgePaceSeconds(current: number, delta: number): number {
  return Math.min(Math.max(current + delta, MIN_PACE_SECONDS), MAX_PACE_SECONDS);
}
