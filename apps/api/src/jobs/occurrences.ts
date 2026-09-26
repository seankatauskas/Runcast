import { DateTime } from 'luxon';

export interface WatchSchedule {
  weekdays: number;
  timezone: string;
  startMinutes: number;
  endMinutes: number;
}

export interface WatchOccurrence {
  date: string;
  windowStart: Date;
  windowEnd: Date;
}

export function occurrenceWithinLeadTime(
  occurrence: Pick<WatchOccurrence, 'windowStart'>,
  leadMinutes: number,
  now: Date,
): boolean {
  return now.getTime() >= occurrence.windowStart.getTime() - leadMinutes * 60_000;
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function weekdayNames(weekdays: number): (typeof WEEKDAY_NAMES)[number][] {
  return WEEKDAY_NAMES.filter((_name, index) => (weekdays & (1 << index)) !== 0);
}

function atMinute(day: DateTime, minutes: number): DateTime | null {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const value = day.set({ hour, minute, second: 0, millisecond: 0 });
  // Luxon advances through nonexistent spring-forward local times. A v1 watch
  // should skip that occurrence instead of silently changing the user's time.
  if (!value.isValid || value.hour !== hour || value.minute !== minute) return null;
  return value;
}

export function upcomingOccurrences(
  schedule: WatchSchedule,
  now: Date,
  horizonHours = 48,
): WatchOccurrence[] {
  const localNow = DateTime.fromJSDate(now, { zone: schedule.timezone });
  if (!localNow.isValid) return [];
  const horizon = DateTime.fromMillis(now.getTime() + horizonHours * 60 * 60_000, {
    zone: schedule.timezone,
  });
  const results: WatchOccurrence[] = [];
  const dayCount = Math.ceil(horizonHours / 24) + 1;
  for (let offset = 0; offset <= dayCount; offset++) {
    const day = localNow.startOf('day').plus({ days: offset });
    const bit = 1 << (day.weekday % 7); // bit 0 Sunday, bit 1 Monday … bit 6 Saturday
    if ((schedule.weekdays & bit) === 0) continue;
    const start = atMinute(day, schedule.startMinutes);
    const end = atMinute(day, schedule.endMinutes);
    if (!start || !end || end <= start) continue;
    if (end < localNow || start > horizon) continue;
    results.push({
      date: day.toISODate()!,
      windowStart: start.toJSDate(),
      windowEnd: end.toJSDate(),
    });
  }
  return results;
}

export function nextOccurrence(schedule: WatchSchedule, now: Date): WatchOccurrence | null {
  return upcomingOccurrences(schedule, now, 8 * 24)[0] ?? null;
}
