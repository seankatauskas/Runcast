import { weeklyStartScheduleSchema, type Preferences } from '@runcast/contracts';
import {
  DEFAULT_ACCEPTABLE_START_WINDOW,
  isValidAcceptableStartWindow,
} from './acceptableStartWindow';

export type PreferenceValues = Omit<Preferences, 'updatedAt' | 'version'>;

export interface PendingPreferences {
  values: PreferenceValues;
  version: number | null;
}

function withCurrentDefaults(values: PreferenceValues): PreferenceValues {
  if (
    values.weeklyStartSchedule != null &&
    !weeklyStartScheduleSchema.safeParse(values.weeklyStartSchedule).success
  ) {
    values = { ...values, weeklyStartSchedule: null };
  }
  if (isValidAcceptableStartWindow(values.acceptableStartMinutes, values.acceptableEndMinutes)) {
    return values;
  }
  return {
    ...values,
    acceptableStartMinutes: DEFAULT_ACCEPTABLE_START_WINDOW.startMinutes,
    acceptableEndMinutes: DEFAULT_ACCEPTABLE_START_WINDOW.endMinutes,
  };
}

/** Migrate the first offline-cache shape without discarding a queued edit. */
export function normalizePendingPreferences(
  cached: PendingPreferences | PreferenceValues,
): PendingPreferences {
  return 'values' in cached
    ? { ...cached, values: withCurrentDefaults(cached.values) }
    : { values: withCurrentDefaults(cached), version: null };
}
