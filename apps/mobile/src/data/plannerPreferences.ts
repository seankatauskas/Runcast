import { weeklyStartScheduleSchema } from '@runcast/contracts';
import { paceToSpeed, speedToPaceSeconds, type UnitSystem } from '@runcast/core';
import {
  DEFAULT_ACCEPTABLE_START_WINDOW,
  isValidAcceptableStartWindow,
} from './acceptableStartWindow';
import type { PreferenceValues } from './preferences';

export const DEFAULT_PLANNER_PREFERENCES: PreferenceValues = {
  units: 'imperial',
  temperatureUnit: 'fahrenheit',
  theme: 'system',
  defaultSpeed: paceToSpeed(8 * 60 + 50, 'imperial'),
  acceptableStartMinutes: DEFAULT_ACCEPTABLE_START_WINDOW.startMinutes,
  acceptableEndMinutes: DEFAULT_ACCEPTABLE_START_WINDOW.endMinutes,
  weeklyStartSchedule: null,
};

function snapSpeed(speed: number, units: UnitSystem): number {
  return paceToSpeed(
    Math.max(
      Math.ceil(speedToPaceSeconds(15, units) / 5),
      Math.round(speedToPaceSeconds(speed, units) / 5),
    ) * 5,
    units,
  );
}

export function normalizePlannerPreferences(values: PreferenceValues): PreferenceValues {
  if (!Number.isFinite(values.defaultSpeed) || values.defaultSpeed <= 0 || values.defaultSpeed > 15)
    throw new RangeError('Running speed is invalid');
  if (!isValidAcceptableStartWindow(values.acceptableStartMinutes, values.acceptableEndMinutes))
    throw new RangeError('Acceptable start window is invalid');
  return {
    ...values,
    defaultSpeed: snapSpeed(values.defaultSpeed, values.units),
    weeklyStartSchedule:
      values.weeklyStartSchedule == null
        ? null
        : weeklyStartScheduleSchema.parse(values.weeklyStartSchedule),
  };
}

/** Read older device snapshots once; remote versioning remains owned by authentication. */
export function readPlannerPreferences(raw: string | null): PreferenceValues {
  if (!raw) return DEFAULT_PLANNER_PREFERENCES;
  try {
    const parsed = JSON.parse(raw);
    const units =
      parsed.units === 'metric' || parsed.units === 'imperial' ? parsed.units : 'imperial';
    const temperatureUnit =
      parsed.temperatureUnit === 'celsius' || parsed.temperatureUnit === 'fahrenheit'
        ? parsed.temperatureUnit
        : units === 'metric'
          ? 'celsius'
          : 'fahrenheit';
    const speed = parsed.defaultSpeed ?? parsed.speed;
    const validWindow = isValidAcceptableStartWindow(
      parsed.acceptableStartMinutes,
      parsed.acceptableEndMinutes,
    );
    const schedule = weeklyStartScheduleSchema.safeParse(parsed.weeklyStartSchedule);
    return normalizePlannerPreferences({
      ...DEFAULT_PLANNER_PREFERENCES,
      units,
      temperatureUnit,
      weeklyStartSchedule: schedule.success ? schedule.data : null,
      theme: ['light', 'dark', 'system'].includes(parsed.theme) ? parsed.theme : 'system',
      defaultSpeed:
        typeof speed === 'number' && Number.isFinite(speed) && speed > 0 && speed <= 15
          ? speed
          : DEFAULT_PLANNER_PREFERENCES.defaultSpeed,
      ...(validWindow
        ? {
            acceptableStartMinutes: parsed.acceptableStartMinutes,
            acceptableEndMinutes: parsed.acceptableEndMinutes,
          }
        : {}),
    });
  } catch {
    return DEFAULT_PLANNER_PREFERENCES;
  }
}

export interface PlannerPreferencesState {
  values: PreferenceValues;
  revision: number;
  hydrated: boolean;
}
export type PlannerPreferenceAction =
  | { type: 'hydrate'; values: PreferenceValues }
  | { type: 'edit'; patch: Partial<PreferenceValues> }
  | { type: 'remote'; values: PreferenceValues };

export const initialPlannerPreferences: PlannerPreferencesState = {
  values: DEFAULT_PLANNER_PREFERENCES,
  revision: 0,
  hydrated: false,
};

export function plannerPreferencesReducer(
  state: PlannerPreferencesState,
  action: PlannerPreferenceAction,
): PlannerPreferencesState {
  if (action.type === 'hydrate')
    return {
      ...state,
      hydrated: true,
      values: state.revision === 0 ? normalizePlannerPreferences(action.values) : state.values,
    };
  const values =
    action.type === 'remote'
      ? {
          units: action.values.units,
          temperatureUnit: action.values.temperatureUnit,
          theme: action.values.theme,
          defaultSpeed: action.values.defaultSpeed,
          acceptableStartMinutes: action.values.acceptableStartMinutes,
          acceptableEndMinutes: action.values.acceptableEndMinutes,
          weeklyStartSchedule: action.values.weeklyStartSchedule ?? null,
        }
      : { ...state.values, ...action.patch };
  return {
    values: normalizePlannerPreferences(values),
    revision: state.revision + 1,
    hydrated: state.hydrated,
  };
}

/** Serialize whole committed snapshots so a slow old write cannot overwrite a newer edit. */
export class PlannerPreferenceWrites {
  private tail = Promise.resolve();
  constructor(private readonly write: (raw: string) => Promise<void>) {}
  enqueue(values: PreferenceValues): Promise<void> {
    const raw = JSON.stringify(values);
    const result = this.tail.then(() => this.write(raw));
    this.tail = result.catch(() => {});
    return result;
  }
}
