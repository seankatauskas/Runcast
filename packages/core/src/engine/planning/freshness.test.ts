import { describe, expect, it } from 'vitest';
import { FORECAST_FRESHNESS_MS, forecastIsFresh } from './freshness';

describe('forecast freshness', () => {
  it('keeps a forecast fresh through exactly 30 minutes', () => {
    const fetchedAt = 1_000_000;
    expect(forecastIsFresh(fetchedAt, fetchedAt + FORECAST_FRESHNESS_MS)).toBe(true);
  });

  it('marks a forecast stale only after the threshold', () => {
    const fetchedAt = 1_000_000;
    expect(forecastIsFresh(fetchedAt, fetchedAt + FORECAST_FRESHNESS_MS + 1)).toBe(false);
  });
});
