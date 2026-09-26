import { FORECAST_FRESHNESS_MS, forecastIsFresh } from '@runcast/core';
import { describe, expect, it, vi } from 'vitest';
import {
  RouteForecastRefreshes,
  forecastRefreshFailed,
  forecastRefreshStarted,
} from './routeForecastRefresh';

describe('direct forecast refresh policy', () => {
  it('does not refresh at the 30-minute freshness boundary', () => {
    const fetchedAt = 10_000;
    expect(forecastIsFresh(fetchedAt, fetchedAt + FORECAST_FRESHNESS_MS)).toBe(true);
  });

  it('deduplicates concurrent stale refreshes and permits a retry after failure', async () => {
    const refreshes = new RouteForecastRefreshes();
    let rejectFirst: ((reason: Error) => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const first = refreshes.run('route-1', refresh);
    const concurrent = refreshes.run('route-1', refresh);
    expect(first).toBe(concurrent);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rejectFirst?.(new Error('offline'));
    await expect(first).rejects.toThrow('offline');

    const retry = vi.fn(async () => {});
    await expect(refreshes.run('route-1', retry)).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('retains cached conditions while loading and after a failure', () => {
    const cached = {
      status: 'ready' as const,
      forecast: { fetchedAt: 1 },
      timezone: 'America/Chicago',
      error: null,
    };
    expect(forecastRefreshStarted(cached)).toMatchObject({
      status: 'loading',
      forecast: cached.forecast,
    });
    expect(forecastRefreshFailed(cached, new Error('offline'))).toMatchObject({
      status: 'error',
      forecast: cached.forecast,
      error: 'offline',
    });
  });
  it('cancels deleted or promoted routes without letting old completion remove a replacement task', async () => {
    const refreshes = new RouteForecastRefreshes();
    let oldSignal!: AbortSignal;
    let finishOld!: () => void;
    let finishNew!: () => void;
    const old = refreshes.run('route', (signal) => {
      oldSignal = signal;
      return new Promise<void>((resolve) => {
        finishOld = resolve;
      });
    });
    await Promise.resolve();
    refreshes.retain(new Set());
    expect(oldSignal.aborted).toBe(true);
    const next = refreshes.run(
      'route',
      () =>
        new Promise<void>((resolve) => {
          finishNew = resolve;
        }),
    );
    await Promise.resolve();
    finishOld();
    await old;
    expect(refreshes.run('route', async () => {})).toBe(next);
    finishNew();
    await next;
  });
});
