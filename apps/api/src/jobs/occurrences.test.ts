import { describe, expect, it } from 'vitest';
import {
  nextOccurrence,
  occurrenceWithinLeadTime,
  upcomingOccurrences,
  weekdayNames,
} from './occurrences';

const everyDay = 127;

describe('watch occurrence scheduling', () => {
  it('converts route-local windows to UTC', () => {
    const [occurrence] = upcomingOccurrences(
      {
        weekdays: everyDay,
        timezone: 'America/Chicago',
        startMinutes: 6 * 60,
        endMinutes: 7 * 60,
      },
      new Date('2026-07-16T08:00:00Z'),
    );
    expect(occurrence.windowStart.toISOString()).toBe('2026-07-16T11:00:00.000Z');
  });

  it('skips nonexistent spring-forward local windows', () => {
    const occurrences = upcomingOccurrences(
      {
        weekdays: everyDay,
        timezone: 'America/Chicago',
        startMinutes: 2 * 60 + 15,
        endMinutes: 3 * 60 + 30,
      },
      new Date('2026-03-08T06:00:00Z'),
      24,
    );
    expect(occurrences).toEqual([]);
  });

  it('creates only one occurrence across fall-back ambiguity', () => {
    const occurrences = upcomingOccurrences(
      {
        weekdays: everyDay,
        timezone: 'America/Chicago',
        startMinutes: 60,
        endMinutes: 150,
      },
      new Date('2026-11-01T04:00:00Z'),
      24,
    );
    expect(occurrences).toHaveLength(1);
  });

  it('computes the next weekly occurrence beyond the scheduler horizon', () => {
    const occurrence = nextOccurrence(
      {
        weekdays: 1 << 1,
        timezone: 'America/Chicago',
        startMinutes: 6 * 60,
        endMinutes: 7 * 60,
      },
      new Date('2026-08-18T12:00:00.000Z'),
    );
    expect(occurrence?.date).toBe('2026-08-24');
    expect(occurrence?.windowStart.toISOString()).toBe('2026-08-24T11:00:00.000Z');
  });

  it('opens scheduler evaluation only when the occurrence reaches its lead-time window', () => {
    const occurrence = { windowStart: new Date('2026-08-18T13:00:00.000Z') };
    expect(occurrenceWithinLeadTime(occurrence, 60, new Date('2026-08-18T11:59:59.999Z'))).toBe(
      false,
    );
    expect(occurrenceWithinLeadTime(occurrence, 60, new Date('2026-08-18T12:00:00.000Z'))).toBe(
      true,
    );
  });

  it('expands the weekday bitmask in display order', () => {
    expect(weekdayNames((1 << 0) | (1 << 2) | (1 << 6))).toEqual(['Sunday', 'Tuesday', 'Saturday']);
  });
});
