import {
  WEEKDAYS,
  type DailyStartWindow,
  type WeeklyStartSchedule,
  type Weekday,
} from '@runcast/core';

export const ACCEPTABLE_START_STEP_MINUTES = 15;
export const MIN_ACCEPTABLE_WINDOW_MINUTES = 60;
export const MAX_ACCEPTABLE_START_MINUTES = 23 * 60 + 45;
export const DEFAULT_ACCEPTABLE_START_WINDOW: DailyStartWindow = {
  startMinutes: 5 * 60,
  endMinutes: 22 * 60,
};

export function isValidAcceptableStartWindow(startMinutes: unknown, endMinutes: unknown): boolean {
  return (
    typeof startMinutes === 'number' &&
    typeof endMinutes === 'number' &&
    Number.isInteger(startMinutes) &&
    Number.isInteger(endMinutes) &&
    startMinutes >= 0 &&
    endMinutes <= MAX_ACCEPTABLE_START_MINUTES &&
    startMinutes % ACCEPTABLE_START_STEP_MINUTES === 0 &&
    endMinutes % ACCEPTABLE_START_STEP_MINUTES === 0 &&
    endMinutes - startMinutes >= MIN_ACCEPTABLE_WINDOW_MINUTES
  );
}

export function clockDateForMinutes(minutes: number): Date {
  return new Date(Date.UTC(2001, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function minutesFromClockDate(date: Date): number {
  const raw = date.getUTCHours() * 60 + date.getUTCMinutes();
  return Math.min(
    Math.round(raw / ACCEPTABLE_START_STEP_MINUTES) * ACCEPTABLE_START_STEP_MINUTES,
    MAX_ACCEPTABLE_START_MINUTES,
  );
}

export function formatClockMinutes(minutes: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(clockDateForMinutes(minutes));
}

/** Older daily preferences become the same window on all seven days. */
export function scheduleFromDailyWindow(window: DailyStartWindow): WeeklyStartSchedule {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, [{ ...window }]])) as WeeklyStartSchedule;
}

export function copyScheduleDay(
  schedule: WeeklyStartSchedule,
  source: Weekday,
  targets: readonly Weekday[],
): WeeklyStartSchedule {
  const next = { ...schedule };
  for (const day of targets) next[day] = schedule[source].map((block) => ({ ...block }));
  return next;
}

/** Each cell represents [hour, hour + 1), including the final hour before midnight. */
export function selectedScheduleHours(intervals: readonly DailyStartWindow[]): boolean[] {
  return Array.from({ length: 24 }, (_, hour) =>
    intervals.some(
      (interval) => interval.startMinutes < (hour + 1) * 60 && interval.endMinutes > hour * 60,
    ),
  );
}

export function intervalsFromHours(hours: readonly boolean[]): DailyStartWindow[] {
  const intervals: DailyStartWindow[] = [];
  for (let hour = 0; hour < 24; hour++) {
    if (!hours[hour]) continue;
    const last = intervals.at(-1);
    if (last?.endMinutes === hour * 60) last.endMinutes += 60;
    else intervals.push({ startMinutes: hour * 60, endMinutes: (hour + 1) * 60 });
  }
  return intervals;
}

export function toggleScheduleHour(
  intervals: readonly DailyStartWindow[],
  hour: number,
): DailyStartWindow[] {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError('Hour must be 0–23');
  const hours = selectedScheduleHours(intervals);
  hours[hour] = !hours[hour];
  return intervalsFromHours(hours);
}

export function formatScheduleIntervals(
  intervals: readonly DailyStartWindow[],
  locale?: string,
): string {
  if (!intervals.length) return 'Day off';
  if (intervals.length === 1 && intervals[0].startMinutes === 0 && intervals[0].endMinutes === 1440)
    return 'All day';
  const parts = (minutes: number) =>
    new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      ...(minutes % 60 ? { minute: '2-digit' as const } : {}),
      timeZone: 'UTC',
    }).formatToParts(clockDateForMinutes(minutes));
  return intervals
    .map(({ startMinutes, endMinutes }) => {
      const start = parts(startMinutes);
      const end = parts(endMinutes);
      const samePeriod =
        endMinutes !== 1440 &&
        start.find((part) => part.type === 'dayPeriod')?.value ===
          end.find((part) => part.type === 'dayPeriod')?.value;
      const from = start
        .filter((part) => !(samePeriod && part.type === 'dayPeriod'))
        .map((part) => part.value)
        .join('')
        .trim();
      const until = endMinutes === 1440 ? 'midnight' : end.map((part) => part.value).join('');
      return `${from}–${until}`.replace(/\s+/g, ' ');
    })
    .join(' · ');
}
