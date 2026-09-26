import { describe, expect, it } from 'vitest';
import { normalizePendingPreferences, type PreferenceValues } from './preferences';

const values: PreferenceValues = {
  units: 'metric',
  temperatureUnit: 'celsius',
  theme: 'dark',
  defaultSpeed: 3.2,
  acceptableStartMinutes: 300,
  acceptableEndMinutes: 1320,
};

describe('offline preference replay', () => {
  it('leaves an old queued edit schedule omitted so replay preserves a newer server schedule', () => {
    expect(normalizePendingPreferences({ values, version: 4 }).values).not.toHaveProperty(
      'weeklyStartSchedule',
    );
  });
  it('repairs a corrupt queued weekly schedule while retaining its base version and other fields', () => {
    const pending = normalizePendingPreferences({
      values: { ...values, weeklyStartSchedule: { mon: [] } } as unknown as PreferenceValues,
      version: 4,
    });
    expect(pending).toEqual({ values: { ...values, weeklyStartSchedule: null }, version: 4 });
  });
  it('preserves the cached base version so concurrent server edits conflict', () => {
    const pending = normalizePendingPreferences({ values, version: 4 });
    expect(pending.version).toBe(4);
  });

  it('migrates an unversioned queued snapshot and uses the current server version', () => {
    const pending = normalizePendingPreferences(values);
    expect(pending).toEqual({ values, version: null });
    expect(pending.version).toBeNull();
  });

  it('adds the acceptable-window defaults to an older queued snapshot', () => {
    const legacy = {
      units: 'metric',
      temperatureUnit: 'celsius',
      theme: 'dark',
      defaultSpeed: 3.2,
    } as PreferenceValues;

    expect(normalizePendingPreferences(legacy).values).toMatchObject({
      acceptableStartMinutes: 300,
      acceptableEndMinutes: 1320,
    });
  });
});

it('preserves weekly windows and days off in offline replay', () => {
  const weeklyStartSchedule = {
    mon: [{ startMinutes: 360, endMinutes: 480 }],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
  expect(
    normalizePendingPreferences({ values: { ...values, weeklyStartSchedule }, version: 4 }),
  ).toEqual({ values: { ...values, weeklyStartSchedule }, version: 4 });
});
