import { calendarDayWindow } from '@runcast/core';

export const PLANNER_QUARTER_HOUR_MS = 15 * 60_000;
export const PLANNER_RECOMMENDATION_STEP_MS = 30 * 60_000;
const PLANNER_WINDOW_HOURS = 47;

export function nextStrictQuarterHour(now: number): number {
  if (!Number.isFinite(now)) throw new TypeError('now must be finite');
  return (Math.floor(now / PLANNER_QUARTER_HOUR_MS) + 1) * PLANNER_QUARTER_HOUR_MS;
}

/** Preserve future choices and replace every elapsed choice with one future boundary. */
export function normalizePlannerStartTime(selection: number, now: number): number {
  if (!Number.isFinite(selection)) throw new TypeError('selection must be finite');
  return selection <= now ? nextStrictQuarterHour(now) : selection;
}

export function plannerSliderWindow(now: number): { min: number; max: number } {
  if (!Number.isFinite(now)) throw new TypeError('now must be finite');
  const min = Math.floor(now / PLANNER_QUARTER_HOUR_MS) * PLANNER_QUARTER_HOUR_MS;
  return { min, max: min + PLANNER_WINDOW_HOURS * 3_600_000 };
}

export function plannerRecommendationWindow(
  now: number,
  sliderMax: number,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { min: number; max: number } {
  if (!Number.isFinite(now)) throw new TypeError('now must be finite');
  const localDay = calendarDayWindow(now, timezone || 'UTC', 0);
  const min =
    localDay.start +
    (Math.floor((now - localDay.start) / PLANNER_RECOMMENDATION_STEP_MS) + 1) *
      PLANNER_RECOMMENDATION_STEP_MS;
  return { min, max: sliderMax };
}

export type PlannerClockAppState = 'active' | 'background' | 'inactive' | string;

export interface PlannerClockRuntime<Timer> {
  now(): number;
  currentAppState(): PlannerClockAppState;
  setTimer(callback: () => void, delayMs: number): Timer;
  clearTimer(timer: Timer): void;
  subscribeAppState(listener: (state: PlannerClockAppState) => void): { remove(): void };
}

/**
 * Keep one boundary timer while active. A delayed timer or foreground jump is
 * reconciled from the current wall clock, so missed intervals never replay.
 */
export function startPlannerClock<Timer>(
  runtime: PlannerClockRuntime<Timer>,
  onReconcile: (now: number) => void,
): () => void {
  let active = runtime.currentAppState() === 'active';
  let stopped = false;
  let timer: Timer | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    runtime.clearTimer(timer);
    timer = null;
  };

  const reconcileAndArm = () => {
    if (stopped || !active) return;
    cancelTimer();
    const now = runtime.now();
    onReconcile(now);
    timer = runtime.setTimer(reconcileAndArm, nextStrictQuarterHour(now) - now);
  };

  const subscription = runtime.subscribeAppState((nextState) => {
    const wasActive = active;
    active = nextState === 'active';
    if (!active) {
      cancelTimer();
    } else if (!wasActive) {
      reconcileAndArm();
    }
  });

  if (active) reconcileAndArm();

  return () => {
    stopped = true;
    cancelTimer();
    subscription.remove();
  };
}
