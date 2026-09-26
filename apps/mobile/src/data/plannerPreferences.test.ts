import { describe, expect, it, vi } from 'vitest';
import { speedToPaceSeconds } from '@runcast/core';
import {
  DEFAULT_PLANNER_PREFERENCES,
  initialPlannerPreferences,
  normalizePlannerPreferences,
  plannerPreferencesReducer,
  PlannerPreferenceWrites,
  readPlannerPreferences,
} from './plannerPreferences';

const weeklyStartSchedule = {
  mon: [{ startMinutes: 360, endMinutes: 480 }],
  tue: [],
  wed: [{ startMinutes: 1020, endMinutes: 1140 }],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};

describe('planner preference transitions', () => {
  it('retains weekly windows and days off through remote hydration, unrelated edits and restart', () => {
    const remote = plannerPreferencesReducer(initialPlannerPreferences, {
      type: 'remote',
      values: { ...DEFAULT_PLANNER_PREFERENCES, weeklyStartSchedule },
    });
    const edited = plannerPreferencesReducer(remote, {
      type: 'edit',
      patch: { theme: 'dark' },
    });
    const restored = readPlannerPreferences(JSON.stringify(edited.values));
    expect(restored).toMatchObject({ theme: 'dark', weeklyStartSchedule });
    expect(
      plannerPreferencesReducer(initialPlannerPreferences, {
        type: 'hydrate',
        values: restored,
      }).values,
    ).toEqual(edited.values);
    const daily = plannerPreferencesReducer(edited, {
      type: 'edit',
      patch: { acceptableStartMinutes: 420, acceptableEndMinutes: 540, weeklyStartSchedule: null },
    });
    expect(daily.values).toMatchObject({
      acceptableStartMinutes: 420,
      acceptableEndMinutes: 540,
      weeklyStartSchedule: null,
    });
  });
  it('defaults missing or invalid stored weekly schedules without losing other preferences', () => {
    for (const schedule of [undefined, { mon: [{ startMinutes: 600, endMinutes: 500 }] }]) {
      const restored = readPlannerPreferences(
        JSON.stringify({
          ...DEFAULT_PLANNER_PREFERENCES,
          theme: 'dark',
          weeklyStartSchedule: schedule,
        }),
      );
      expect(restored).toMatchObject({ theme: 'dark', weeklyStartSchedule: null });
    }
    expect(() =>
      normalizePlannerPreferences({
        ...DEFAULT_PLANNER_PREFERENCES,
        weeklyStartSchedule: {
          ...weeklyStartSchedule,
          mon: [{ startMinutes: 600, endMinutes: 500 }],
        },
      }),
    ).toThrow();
  });
  it('merges rapid partial edits and keeps them when slow hydration completes', () => {
    let state = plannerPreferencesReducer(initialPlannerPreferences, {
      type: 'edit',
      patch: { units: 'metric' },
    });
    state = plannerPreferencesReducer(state, { type: 'edit', patch: { theme: 'dark' } });
    state = plannerPreferencesReducer(state, {
      type: 'hydrate',
      values: DEFAULT_PLANNER_PREFERENCES,
    });
    expect(state.values).toMatchObject({ units: 'metric', theme: 'dark' });
    expect(state.hydrated).toBe(true);
    expect(speedToPaceSeconds(state.values.defaultSpeed, 'metric') % 5).toBeCloseTo(0);
  });
  it('migrates old device speed and normalizes remote snapshots exactly once', () => {
    const old = readPlannerPreferences(JSON.stringify({ units: 'metric', speed: 3.19 }));
    expect(old.temperatureUnit).toBe('celsius');
    expect(old.defaultSpeed).not.toBe(3.19);
    const state = plannerPreferencesReducer(initialPlannerPreferences, {
      type: 'remote',
      values: { ...old, defaultSpeed: 3.19 },
    });
    expect(state.values).toEqual(old);
    expect(normalizePlannerPreferences(state.values)).toEqual(state.values);
  });
  it('rejects invalid edits and recovers corrupt stored preferences', () => {
    expect(readPlannerPreferences('{')).toEqual(DEFAULT_PLANNER_PREFERENCES);
    expect(() =>
      normalizePlannerPreferences({ ...DEFAULT_PLANNER_PREFERENCES, defaultSpeed: NaN }),
    ).toThrow();
    expect(() =>
      normalizePlannerPreferences({ ...DEFAULT_PLANNER_PREFERENCES, acceptableStartMinutes: 2000 }),
    ).toThrow();
    expect(
      normalizePlannerPreferences({ ...DEFAULT_PLANNER_PREFERENCES, defaultSpeed: 15 })
        .defaultSpeed,
    ).toBeLessThanOrEqual(15);
  });
  it('serializes committed snapshots and keeps later writes after an earlier failure', async () => {
    let failFirst!: (error: Error) => void;
    const stored: string[] = [];
    const write = vi.fn((raw: string) => {
      stored.push(raw);
      return stored.length === 1
        ? new Promise<void>((_, reject) => {
            failFirst = reject;
          })
        : Promise.resolve();
    });
    const queue = new PlannerPreferenceWrites(write);
    const first = queue.enqueue(DEFAULT_PLANNER_PREFERENCES);
    const failed = expect(first).rejects.toThrow('disk busy');
    const latest = { ...DEFAULT_PLANNER_PREFERENCES, theme: 'dark' as const };
    const second = queue.enqueue(latest);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    failFirst(new Error('disk busy'));
    await failed;
    await second;
    expect(stored.map((raw) => JSON.parse(raw))).toEqual([DEFAULT_PLANNER_PREFERENCES, latest]);
  });
});
