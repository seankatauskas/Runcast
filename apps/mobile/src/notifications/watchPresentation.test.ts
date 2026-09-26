import { describe, expect, it } from 'vitest';
import { nextOccurrenceSummary, weekdaySummary } from './watchPresentation';

describe('watch presentation', () => {
  it('shows readable weekday names supplied by the server', () => {
    expect(weekdaySummary(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])).toBe(
      'Weekdays',
    );
    expect(weekdaySummary(['Sunday', 'Wednesday', 'Saturday'])).toBe('Sun, Wed, Sat');
  });

  it('shows the next server-computed occurrence in the watch timezone', () => {
    expect(
      nextOccurrenceSummary(
        {
          timezone: 'America/Chicago',
          nextOccurrence: {
            date: '2026-08-16',
            windowStart: '2026-08-16T11:00:00.000Z',
            windowEnd: '2026-08-16T13:00:00.000Z',
          },
        },
        'en-US',
      ),
    ).toBe('Next: Sunday, Aug 16 · 6:00 AM–8:00 AM');
  });
});
