/**
 * The single SI → display conversion layer. The engine speaks meters, m/s
 * and °C; everything user-facing goes through here and nowhere else.
 */

export type UnitSystem = 'metric' | 'imperial';
export type TemperatureUnit = 'celsius' | 'fahrenheit';

export interface DailyStartWindow {
  /** Inclusive route-local minute after midnight. */
  startMinutes: number;
  /** Route-local ending minute; exclusive in weekly schedules, inclusive for legacy daily windows. */
  endMinutes: number;
}

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** An empty day has no recommended starts. Intervals use route-local clock time with exclusive ends. */
export type WeeklyStartSchedule = Record<Weekday, DailyStartWindow[]>;

export interface ZonedDailyStartWindow extends DailyStartWindow {
  timezone: string;
  weeklySchedule?: WeeklyStartSchedule | null;
}

export const M_PER_MI = 1609.344;
export const MM_PER_IN = 25.4;

export function fmtDistance(meters: number, u: UnitSystem): string {
  return u === 'metric'
    ? `${(meters / 1000).toFixed(meters >= 10_000 ? 1 : 2)} km`
    : `${(meters / M_PER_MI).toFixed(meters >= 10 * M_PER_MI ? 1 : 2)} mi`;
}

export function fmtTemp(celsius: number, u: UnitSystem | TemperatureUnit): string {
  const v = u === 'metric' || u === 'celsius' ? celsius : celsius * 1.8 + 32;
  return `${Math.round(v)}°`;
}

export function fmtWindSpeed(ms: number, u: UnitSystem): string {
  return u === 'metric' ? `${(ms * 3.6).toFixed(0)} km/h` : `${(ms * 2.23694).toFixed(0)} mph`;
}

export function fmtPrecipRate(mmPerHour: number, u: UnitSystem): string {
  return u === 'metric'
    ? `${mmPerHour.toFixed(1)} mm/h`
    : `${(mmPerHour / MM_PER_IN).toFixed(1)} in/h`;
}

/** Speed in m/s → "5:32 /km" or "8:54 /mi". */
export function fmtPace(speed: number, u: UnitSystem): string {
  const secPerUnit = (u === 'metric' ? 1000 : M_PER_MI) / speed;
  const min = Math.floor(secPerUnit / 60);
  const sec = Math.round(secPerUnit % 60);
  const s = sec === 60 ? 0 : sec;
  const m = sec === 60 ? min + 1 : min;
  return `${m}:${String(s).padStart(2, '0')} /${u === 'metric' ? 'km' : 'mi'}`;
}

/** Pace in seconds per display unit → speed in m/s. */
export function paceToSpeed(secondsPerUnit: number, u: UnitSystem): number {
  return (u === 'metric' ? 1000 : M_PER_MI) / secondsPerUnit;
}

export function speedToPaceSeconds(speed: number, u: UnitSystem): number {
  return (u === 'metric' ? 1000 : M_PER_MI) / speed;
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

/** Epoch ms → "6:45 AM" in the route's timezone (falls back to local). */
export function fmtClock(t: number, timezone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(t);
}

export function fmtDay(t: number, timezone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(t);
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface CalendarDayWindow {
  /** Inclusive route-local midnight, represented as an epoch instant. */
  start: number;
  /** Exclusive next route-local midnight, represented as an epoch instant. */
  end: number;
}

function wallClockParts(t: number, timezone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(t);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** Minute after midnight for an instant in the supplied route timezone. */
export function localMinutesOfDay(instant: number, timezone: string): number {
  if (!Number.isFinite(instant)) throw new TypeError('instant must be finite');
  if (!timezone) throw new TypeError('timezone must not be empty');
  const local = wallClockParts(instant, timezone);
  return local.hour * 60 + local.minute;
}

/** Weekday in the route's timezone, independent of the device timezone and DST. */
export function localWeekday(instant: number, timezone: string): Weekday {
  const local = wallClockParts(instant, timezone);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  return WEEKDAYS[(day + 6) % 7];
}

export function startWindowsForDay(
  instant: number,
  window: ZonedDailyStartWindow,
): DailyStartWindow[] {
  return window.weeklySchedule
    ? window.weeklySchedule[localWeekday(instant, window.timezone)]
    : [window];
}

/** Whether an instant's route-local clock time is acceptable for a recommendation. */
export function isStartWithinDailyWindow(instant: number, window: ZonedDailyStartWindow): boolean {
  if (!Number.isFinite(instant)) throw new TypeError('instant must be finite');
  if (!window.timezone) throw new TypeError('timezone must not be empty');
  const blocks = startWindowsForDay(instant, window);
  const minutes = localMinutesOfDay(instant, window.timezone);
  return blocks.some((day) => {
    if (
      !Number.isInteger(day.startMinutes) ||
      !Number.isInteger(day.endMinutes) ||
      day.startMinutes < 0 ||
      day.startMinutes >= 1440 ||
      day.endMinutes > 1440 ||
      day.endMinutes < day.startMinutes
    )
      throw new RangeError('daily start window is invalid');
    return (
      minutes >= day.startMinutes &&
      (window.weeklySchedule ? minutes < day.endMinutes : minutes <= day.endMinutes)
    );
  });
}

function wallClockInstant(desired: WallClockParts, millisecond: number, timezone: string): number {
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
    millisecond,
  );
  let guess = desiredAsUtc;

  // Resolve the zone's offset at this date. The offset can change between
  // consecutive midnights, so each boundary is resolved independently.
  for (let i = 0; i < 6; i++) {
    const observed = wallClockParts(guess, timezone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      ((guess % 1000) + 1000) % 1000,
    );
    const correction = desiredAsUtc - observedAsUtc;
    if (correction === 0) break;
    guess += correction;
  }
  return guess;
}

/**
 * Return one route-local calendar day as [start, end). Boundaries are
 * resolved in the supplied IANA zone, so daylight-saving days may be 23 or
 * 25 hours long instead of assuming a fixed 24-hour duration.
 */
export function calendarDayWindow(
  instant: number,
  timezone: string,
  dayOffset = 0,
): CalendarDayWindow {
  if (!Number.isFinite(instant)) throw new TypeError('instant must be finite');
  if (!Number.isInteger(dayOffset)) throw new TypeError('dayOffset must be an integer');
  if (!timezone) throw new TypeError('timezone must not be empty');

  const local = wallClockParts(instant, timezone);
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  const startDate = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const next = new Date(Date.UTC(startDate.year, startDate.month - 1, startDate.day + 1));
  const endDate = {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
  return {
    start: wallClockInstant(startDate, 0, timezone),
    end: wallClockInstant(endDate, 0, timezone),
  };
}

/**
 * Move an instant between IANA time zones while preserving its displayed
 * calendar date and clock time. This is only for flows that explicitly want
 * wall-clock preservation; route comparison keeps the instant unchanged and
 * formats it in the selected route's timezone instead.
 */
export function preserveWallClockTime(t: number, fromTimezone: string, toTimezone: string): number {
  if (fromTimezone === toTimezone) return t;
  const desired = wallClockParts(t, fromTimezone);
  return wallClockInstant(desired, ((t % 1000) + 1000) % 1000, toTimezone);
}

export function fmtPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
