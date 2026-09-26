import { describe, expect, it } from 'vitest';
import {
  scheduleFromDailyWindow,
  selectedScheduleHours,
  toggleScheduleHour,
  intervalsFromHours,
  formatScheduleIntervals,
  copyScheduleDay,
  DEFAULT_ACCEPTABLE_START_WINDOW,
  clockDateForMinutes,
  isValidAcceptableStartWindow,
  minutesFromClockDate,
} from './acceptableStartWindow';

describe('acceptable start window preference', () => {
  it('uses a useful daytime default', () => {
    expect(DEFAULT_ACCEPTABLE_START_WINDOW).toEqual({ startMinutes: 300, endMinutes: 1320 });
  });

  it('requires quarter-hour boundaries and at least one hour', () => {
    expect(isValidAcceptableStartWindow(300, 1320)).toBe(true);
    expect(isValidAcceptableStartWindow(307, 1320)).toBe(false);
    expect(isValidAcceptableStartWindow(300, 345)).toBe(false);
  });

  it('round-trips and snaps native picker dates', () => {
    expect(minutesFromClockDate(clockDateForMinutes(315))).toBe(315);
    expect(minutesFromClockDate(new Date(Date.UTC(2001, 0, 1, 23, 59)))).toBe(1425);
  });
});

describe('weekly schedule editing', () => {
  it('preserves old preferences on every day without sharing mutable windows', () => {
    const week = scheduleFromDailyWindow(DEFAULT_ACCEPTABLE_START_WINDOW);
    expect(Object.keys(week)).toHaveLength(7);
    expect(week.sun).toEqual([DEFAULT_ACCEPTABLE_START_WINDOW]);
    expect(week.mon).not.toBe(week.tue);
  });
  it('copies weekday availability without changing the weekend or original', () => {
    const week = scheduleFromDailyWindow(DEFAULT_ACCEPTABLE_START_WINDOW);
    week.mon = [
      { startMinutes: 360, endMinutes: 480 },
      { startMinutes: 1020, endMinutes: 1140 },
    ];
    const copied = copyScheduleDay(week, 'mon', ['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(copied.fri).toEqual(week.mon);
    expect(copied.sat).toEqual([DEFAULT_ACCEPTABLE_START_WINDOW]);
    expect(week.tue).toEqual([DEFAULT_ACCEPTABLE_START_WINDOW]);
    week.mon = [];
    expect(copyScheduleDay(week, 'mon', ['tue']).tue).toEqual([]);
  });
});

describe('hour selection', () => {
  it('merges neighboring hours and splits them when an hour is deselected', () => {
    let intervals = toggleScheduleHour([], 6);
    intervals = toggleScheduleHour(intervals, 7);
    intervals = toggleScheduleHour(intervals, 8);
    expect(intervals).toEqual([{ startMinutes: 360, endMinutes: 540 }]);
    expect(toggleScheduleHour(intervals, 7)).toEqual([
      { startMinutes: 360, endMinutes: 420 },
      { startMinutes: 480, endMinutes: 540 },
    ]);
  });
  it('keeps separated hours, midnight, all-day and days off accurate', () => {
    const intervals = intervalsFromHours(
      Array.from({ length: 24 }, (_, hour) => [0, 6, 7, 17, 18, 23].includes(hour)),
    );
    expect(formatScheduleIntervals(intervals, 'en-US')).toBe(
      '12–1 AM · 6–8 AM · 5–7 PM · 11 PM–midnight',
    );
    expect(formatScheduleIntervals([], 'en-US')).toBe('Day off');
    expect(formatScheduleIntervals(intervalsFromHours(Array(24).fill(true)), 'en-US')).toBe(
      'All day',
    );
    expect(selectedScheduleHours(intervals).filter(Boolean)).toHaveLength(6);
    expect(toggleScheduleHour([{ startMinutes: 1380, endMinutes: 1440 }], 23)).toEqual([]);
  });
  it('displays every interval, including alternating hours', () => {
    const intervals = intervalsFromHours(Array.from({ length: 24 }, (_, hour) => hour % 2 === 0));
    expect(intervals).toHaveLength(12);
    expect(formatScheduleIntervals(intervals, 'en-US').split(' · ')).toHaveLength(12);
  });
});
