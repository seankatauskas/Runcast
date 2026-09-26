/** Forecasts older than this require a refresh before they are considered current. */
export const FORECAST_FRESHNESS_MS = 30 * 60_000;

/** The threshold itself is still fresh; only forecasts strictly older are stale. */
export function forecastIsFresh(fetchedAt: number, now: number): boolean {
  return Number.isFinite(fetchedAt) && now - fetchedAt <= FORECAST_FRESHNESS_MS;
}
