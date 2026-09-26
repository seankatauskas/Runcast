import type { Watch, WatchResultStatus } from '@runcast/contracts';

export const WATCH_RESULT_LABELS: Record<WatchResultStatus, string> = {
  recommended: 'Recommended',
  caution: 'Caution',
  'no-suitable-window': 'No suitable start',
  unavailable: 'Forecast unavailable',
};

export function weekdaySummary(names: Watch['weekdayNames']): string {
  if (names.length === 0) return 'Weekdays update when online';
  if (names.length === 7) return 'Every day';
  if (
    names.length === 5 &&
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].every((name) =>
      names.includes(name as Watch['weekdayNames'][number]),
    )
  ) {
    return 'Weekdays';
  }
  return names.map((name) => name.slice(0, 3)).join(', ');
}

export function nextOccurrenceSummary(
  watch: Pick<Watch, 'nextOccurrence' | 'timezone'>,
  locale = 'en-US',
): string {
  if (!watch.nextOccurrence) return 'No upcoming occurrence';
  const date = new Date(watch.nextOccurrence.windowStart);
  const end = new Date(watch.nextOccurrence.windowEnd);
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: watch.timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: watch.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Next: ${day} · ${time.format(date)}–${time.format(end)}`;
}
