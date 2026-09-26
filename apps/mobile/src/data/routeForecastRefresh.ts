export interface ForecastCacheEntry<TField> {
  status: 'loading' | 'ready' | 'error';
  forecast: TField | null;
  timezone: string | null;
  error: string | null;
}

export function forecastRefreshStarted<TField>(
  previous?: ForecastCacheEntry<TField>,
): ForecastCacheEntry<TField> {
  return {
    status: 'loading',
    forecast: previous?.forecast ?? null,
    timezone: previous?.timezone ?? null,
    error: null,
  };
}

export function forecastRefreshFailed<TField>(
  previous: ForecastCacheEntry<TField> | undefined,
  error: unknown,
): ForecastCacheEntry<TField> {
  return {
    status: 'error',
    forecast: previous?.forecast ?? null,
    timezone: previous?.timezone ?? null,
    error: error instanceof Error ? error.message : 'Forecast unavailable.',
  };
}

/** One owner for request deduplication and cancellation when a route leaves direct acquisition. */
export class RouteForecastRefreshes {
  private readonly pending = new Map<
    string,
    { controller: AbortController; task: Promise<void> }
  >();
  run(routeId: string, refresh: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const existing = this.pending.get(routeId);
    if (existing && !existing.controller.signal.aborted) return existing.task;
    const controller = new AbortController();
    const task = Promise.resolve()
      .then(() => refresh(controller.signal))
      .finally(() => {
        if (this.pending.get(routeId)?.task === task) this.pending.delete(routeId);
      });
    this.pending.set(routeId, { controller, task });
    return task;
  }
  retain(routeIds: ReadonlySet<string>): void {
    for (const [id, pending] of this.pending) if (!routeIds.has(id)) pending.controller.abort();
  }
}
