import { describe, expect, it } from 'vitest';
import {
  calendarDayWindow,
  fmtClock,
  fmtDay,
  fmtPrecipRate,
  fmtTemp,
  isStartWithinDailyWindow,
  localMinutesOfDay,
  type WeeklyStartSchedule,
  preserveWallClockTime,
} from './units';

describe('fmtTemp', () => {
  it('formats Celsius and Fahrenheit independently of distance units', () => {
    expect(fmtTemp(20, 'celsius')).toBe('20°');
    expect(fmtTemp(20, 'fahrenheit')).toBe('68°');
  });

  it('keeps UnitSystem inputs compatible for web consumers', () => {
    expect(fmtTemp(20, 'metric')).toBe('20°');
    expect(fmtTemp(20, 'imperial')).toBe('68°');
  });
});

describe('fmtPrecipRate', () => {
  it('formats the engine mm/h value for the selected unit system', () => {
    expect(fmtPrecipRate(25.4, 'metric')).toBe('25.4 mm/h');
    expect(fmtPrecipRate(25.4, 'imperial')).toBe('1.0 in/h');
    expect(fmtPrecipRate(7, 'imperial')).toBe('0.3 in/h');
  });
});

describe('route-local clocks', () => {
  it('renders one instant in each route timezone without changing that instant', () => {
    const instant = Date.parse('2026-07-14T20:45:00Z');
    const chicago = fmtClock(instant, 'America/Chicago');
    const newYork = fmtClock(instant, 'America/New_York');

    expect(newYork).not.toBe(chicago);
    expect(fmtClock(instant, 'America/Chicago')).toBe(chicago);
  });

  it('groups Today and Tomorrow in the route timezone', () => {
    const instant = Date.parse('2026-07-20T01:00:00Z');
    const today = calendarDayWindow(instant, 'America/Chicago', 0);
    const tomorrow = calendarDayWindow(instant, 'America/Chicago', 1);

    expect(today).toEqual({
      start: Date.parse('2026-07-19T05:00:00Z'),
      end: Date.parse('2026-07-20T05:00:00Z'),
    });
    expect(tomorrow.start).toBe(today.end);
    expect(fmtDay(today.start, 'America/Chicago')).not.toBe(
      fmtDay(tomorrow.start, 'America/Chicago'),
    );
  });

  it.each([
    ['spring-forward', '2026-03-08T18:00:00Z', 23],
    ['fall-back', '2026-11-01T18:00:00Z', 25],
  ] as const)('returns a %s calendar day with its real duration', (_label, instant, hours) => {
    const window = calendarDayWindow(Date.parse(instant), 'America/Chicago', 0);
    expect(window.end - window.start).toBe(hours * 60 * 60_000);
  });

  it('checks inclusive acceptable starts in the route timezone', () => {
    const window = {
      startMinutes: 5 * 60,
      endMinutes: 22 * 60,
      timezone: 'America/Chicago',
    };

    expect(isStartWithinDailyWindow(Date.parse('2026-09-02T10:00:00.000Z'), window)).toBe(true);
    expect(isStartWithinDailyWindow(Date.parse('2026-09-03T03:00:00.000Z'), window)).toBe(true);
    expect(isStartWithinDailyWindow(Date.parse('2026-09-03T03:15:00.000Z'), window)).toBe(false);
  });

  it('reads route-local minutes without using the device timezone', () => {
    expect(localMinutesOfDay(Date.parse('2026-09-03T02:59:00.000Z'), 'America/Chicago')).toBe(
      21 * 60 + 59,
    );
    expect(localMinutesOfDay(Date.parse('2026-09-03T03:00:00.000Z'), 'America/Chicago')).toBe(
      22 * 60,
    );
  });
});

describe('preserveWallClockTime', () => {
  it('keeps the same local date and time when moving from Chicago to New York', () => {
    const chicago = Date.parse('2026-07-14T15:45:00-05:00');
    const newYork = preserveWallClockTime(chicago, 'America/Chicago', 'America/New_York');

    expect(newYork).toBe(Date.parse('2026-07-14T15:45:00-04:00'));
    expect(fmtDay(newYork, 'America/New_York')).toBe(fmtDay(chicago, 'America/Chicago'));
    expect(fmtClock(newYork, 'America/New_York')).toBe(fmtClock(chicago, 'America/Chicago'));
  });

  it('round-trips across time zones during standard time', () => {
    const chicago = Date.parse('2026-01-14T07:15:00-06:00');
    const newYork = preserveWallClockTime(chicago, 'America/Chicago', 'America/New_York');
    expect(preserveWallClockTime(newYork, 'America/New_York', 'America/Chicago')).toBe(chicago);
  });
});

describe('weekly start schedules', () => {
  const off: WeeklyStartSchedule = {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
  const window = { startMinutes: 300, endMinutes: 1320, timezone: 'America/Chicago' };
  it('uses the route weekday even when UTC has moved to Monday', () => {
    const scheduled = {
      ...window,
      weeklySchedule: { ...off, mon: [{ startMinutes: 0, endMinutes: 1440 }] },
    };
    expect(isStartWithinDailyWindow(Date.parse('2026-09-21T00:30:00Z'), scheduled)).toBe(false);
    expect(isStartWithinDailyWindow(Date.parse('2026-09-21T05:30:00Z'), scheduled)).toBe(true);
  });
  it('honors both repeated local hours when daylight saving time ends', () => {
    const scheduled = {
      ...window,
      weeklySchedule: { ...off, sun: [{ startMinutes: 60, endMinutes: 120 }] },
    };
    expect(isStartWithinDailyWindow(Date.parse('2026-11-01T06:30:00Z'), scheduled)).toBe(true);
    expect(isStartWithinDailyWindow(Date.parse('2026-11-01T07:30:00Z'), scheduled)).toBe(true);
    expect(isStartWithinDailyWindow(Date.parse('2026-11-01T08:30:00Z'), scheduled)).toBe(false);
  });
  it('allows the end of a day without spilling into a day off', () => {
    const scheduled = {
      ...window,
      weeklySchedule: { ...off, sun: [{ startMinutes: 1380, endMinutes: 1440 }] },
    };
    expect(isStartWithinDailyWindow(Date.parse('2026-09-21T04:45:00Z'), scheduled)).toBe(true);
    expect(isStartWithinDailyWindow(Date.parse('2026-09-21T05:00:00Z'), scheduled)).toBe(false);
  });
});

it('allows morning and evening blocks while excluding the gap', () => {
  const weeklySchedule: WeeklyStartSchedule = {
    mon: [
      { startMinutes: 360, endMinutes: 480 },
      { startMinutes: 1020, endMinutes: 1140 },
    ],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
  const window = {
    startMinutes: 300,
    endMinutes: 1320,
    timezone: 'America/Chicago',
    weeklySchedule,
  };
  expect(isStartWithinDailyWindow(Date.parse('2026-09-21T12:00:00Z'), window)).toBe(true);
  expect(isStartWithinDailyWindow(Date.parse('2026-09-21T17:00:00Z'), window)).toBe(false);
  expect(isStartWithinDailyWindow(Date.parse('2026-09-21T23:00:00Z'), window)).toBe(true);
});

it('excludes an unselected hour exactly at the end of a weekly interval', () => {
  const window = {
    startMinutes: 300,
    endMinutes: 1320,
    timezone: 'America/Chicago',
    weeklySchedule: {
      mon: [{ startMinutes: 360, endMinutes: 480 }],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    },
  };
  expect(isStartWithinDailyWindow(Date.parse('2026-09-21T12:45:00Z'), window)).toBe(true);
  expect(isStartWithinDailyWindow(Date.parse('2026-09-21T13:00:00Z'), window)).toBe(false);
});
