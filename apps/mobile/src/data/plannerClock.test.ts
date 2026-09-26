import { describe, expect, it, vi } from 'vitest';
import {
  PLANNER_QUARTER_HOUR_MS,
  PLANNER_RECOMMENDATION_STEP_MS,
  nextStrictQuarterHour,
  normalizePlannerStartTime,
  plannerRecommendationWindow,
  plannerSliderWindow,
  startPlannerClock,
  type PlannerClockAppState,
} from './plannerClock';

const Q = PLANNER_QUARTER_HOUR_MS;
const H = PLANNER_RECOMMENDATION_STEP_MS;

describe('planner clock policy', () => {
  it('returns the next strictly future quarter-hour', () => {
    expect(nextStrictQuarterHour(4 * Q)).toBe(5 * Q);
    expect(nextStrictQuarterHour(4 * Q + 1)).toBe(5 * Q);
    expect(nextStrictQuarterHour(4 * Q + Q - 1)).toBe(5 * Q);
  });

  it('preserves future manual choices and advances every kind of elapsed choice once', () => {
    const now = 8 * Q;
    expect(normalizePlannerStartTime(10 * Q, now)).toBe(10 * Q);

    for (const elapsed of [8 * Q, 7 * Q, Q]) {
      const advanced = normalizePlannerStartTime(elapsed, now);
      expect(advanced).toBe(9 * Q);
      expect(normalizePlannerStartTime(advanced, now)).toBe(advanced);
    }
  });

  it('moves the slider while keeping recommendations on stable future half-hours', () => {
    const first = plannerSliderWindow(8 * Q + 1);
    const afterMissedIntervals = plannerSliderWindow(12 * Q + 1);
    const recommendation = plannerRecommendationWindow(8 * Q + 1, first.max, 'UTC');
    expect(first.min).toBe(8 * Q);
    expect(recommendation.min).toBe(5 * H);
    expect(recommendation.min).toBeGreaterThan(8 * Q + 1);
    expect(plannerRecommendationWindow(9 * Q + 1, first.max, 'UTC').min).toBe(5 * H);
    expect(plannerRecommendationWindow(10 * Q, first.max, 'UTC').min).toBe(6 * H);
    expect(afterMissedIntervals.min).toBe(12 * Q);
    expect(afterMissedIntervals.max).toBeGreaterThan(first.max);
  });

  it('aligns recommendations to route-local half-hours in quarter-offset timezones', () => {
    const now = Date.UTC(2026, 0, 1, 0, 1); // 5:46 AM in Kathmandu.
    const max = now + 24 * 60 * 60_000;

    expect(plannerRecommendationWindow(now, max, 'Asia/Kathmandu').min).toBe(
      Date.UTC(2026, 0, 1, 0, 15), // 6:00 AM in Kathmandu.
    );
  });
});

describe('planner clock lifecycle', () => {
  it('reconciles delayed timers once and rearms from the current boundary', () => {
    let now = 2 * Q + 1;
    let appState: PlannerClockAppState = 'active';
    let emitAppState = (_state: PlannerClockAppState): void => {
      throw new Error('app-state listener was not installed');
    };
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let timerId = 0;
    const reconciled: number[] = [];

    const stop = startPlannerClock(
      {
        now: () => now,
        currentAppState: () => appState,
        setTimer: (callback, delay) => {
          const id = ++timerId;
          timers.set(id, { callback, delay });
          return id;
        },
        clearTimer: (id) => timers.delete(id),
        subscribeAppState: (next) => {
          emitAppState = next;
          return { remove: vi.fn() };
        },
      },
      (value) => reconciled.push(value),
    );

    expect(reconciled).toEqual([now]);
    expect([...timers.values()][0].delay).toBe(Q - 1);

    const delayed = [...timers.values()][0].callback;
    now = 9 * Q + 123;
    delayed();
    expect(reconciled).toEqual([2 * Q + 1, 9 * Q + 123]);
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].delay).toBe(Q - 123);

    appState = 'background';
    emitAppState(appState);
    expect(timers.size).toBe(0);

    now = 13 * Q + 7;
    appState = 'active';
    emitAppState(appState);
    expect(reconciled.at(-1)).toBe(now);
    expect(timers.size).toBe(1);

    stop();
    expect(timers.size).toBe(0);
  });
});
