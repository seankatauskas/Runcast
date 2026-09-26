import { describe, expect, it, vi } from 'vitest';
import { FORECAST_FRESHNESS_MS } from '@runcast/core';
import {
  refreshPlanningBundleUntilFresh,
  syncPlanningBundle,
  type PlanningBundleHttpResult,
} from './planningBundleSync';
import type { CachedPlanningBundle } from './planningBundle';

const prior = { etag: '"old"' } as CachedPlanningBundle;
const next = { etag: '"new"' } as CachedPlanningBundle;

function dependencies(response: PlanningBundleHttpResult | Error, cached = prior) {
  return {
    read: vi.fn().mockResolvedValue(cached),
    request: vi.fn().mockImplementation(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
    promote: vi.fn().mockResolvedValue(next),
  };
}

describe('planning bundle conditional sync', () => {
  it('promotes a modified response and sends the prior ETag', async () => {
    const deps = dependencies({ status: 'modified', body: '{}', etag: '"new"' });
    const result = await syncPlanningBundle(deps);
    expect(deps.request).toHaveBeenCalledWith('"old"');
    expect(deps.promote).toHaveBeenCalledWith('{}', '"new"');
    expect(result).toMatchObject({ state: 'modified', cached: next, reasons: [] });
  });

  it('hydrates 304 and rejects a 304 without an offline row', async () => {
    expect(
      await syncPlanningBundle(dependencies({ status: 'not-modified', etag: '"old"' })),
    ).toMatchObject({ state: 'not-modified', cached: prior });
    expect(
      await syncPlanningBundle(
        dependencies({ status: 'not-modified', etag: '"old"' }, null as never),
      ),
    ).toMatchObject({ state: 'unavailable', cached: null });
  });

  it.each([
    [{ status: 'preparing', retryAfterSeconds: 7 } as const, 'preparing'],
    [{ status: 'unavailable', reason: 'forecast down' } as const, 'unavailable'],
    [{ status: 'update-required', reason: 'reader old' } as const, 'update-required'],
  ])('retains the prior row for $state', async (response, state) => {
    const result = await syncPlanningBundle(dependencies(response));
    expect(result).toMatchObject({ state, cached: prior });
  });

  it('retains the prior row on network or validation failure', async () => {
    expect(await syncPlanningBundle(dependencies(new Error('offline')))).toMatchObject({
      state: 'unavailable',
      cached: prior,
      reasons: ['bundle.refresh-failed'],
    });
    const deps = dependencies({ status: 'modified', body: '{}', etag: '"new"' });
    deps.promote.mockRejectedValueOnce(
      Object.assign(new Error('bad'), { code: 'bundle.hash-mismatch' }),
    );
    expect(await syncPlanningBundle(deps)).toMatchObject({
      state: 'unavailable',
      cached: prior,
      reasons: ['bundle.hash-mismatch'],
    });
  });
});

describe('targeted planning bundle refresh', () => {
  function cachedAt(fetchedAt: number, etag: string): CachedPlanningBundle {
    return {
      etag,
      bundle: { forecast: { data: { fetchedAt } } },
    } as CachedPlanningBundle;
  }

  it('retries stale responses after five seconds, at most three times, until fresh', async () => {
    const now = 2_000_000_000;
    let cached = cachedAt(now - FORECAST_FRESHNESS_MS - 1, '"stale"');
    const fresh = cachedAt(now, '"fresh"');
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 'not-modified', etag: '"stale"' })
      .mockResolvedValueOnce({ status: 'not-modified', etag: '"stale"' })
      .mockResolvedValueOnce({ status: 'not-modified', etag: '"stale"' })
      .mockResolvedValueOnce({ status: 'modified', body: '{}', etag: '"fresh"' });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await refreshPlanningBundleUntilFresh(
      {
        read: async () => cached,
        request,
        promote: async () => (cached = fresh),
      },
      { now: () => now, sleep },
    );

    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenNthCalledWith(1, 5_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 5_000);
    expect(sleep).toHaveBeenNthCalledWith(3, 5_000);
    expect(result.cached).toBe(fresh);
  });

  it('does not request again for a fresh cache and stops on network failure', async () => {
    const now = 2_000_000_000;
    const fresh = cachedAt(now - FORECAST_FRESHNESS_MS, '"fresh"');
    const freshDeps = dependencies({ status: 'not-modified', etag: '"fresh"' }, fresh);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await refreshPlanningBundleUntilFresh(freshDeps, { now: () => now, sleep });
    expect(freshDeps.request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();

    const stale = cachedAt(now - FORECAST_FRESHNESS_MS - 1, '"stale"');
    const failedDeps = dependencies(new Error('offline'), stale);
    const failed = await refreshPlanningBundleUntilFresh(failedDeps, {
      now: () => now,
      sleep,
    });
    expect(failed).toMatchObject({ state: 'unavailable', cached: stale });
    expect(failedDeps.request).toHaveBeenCalledTimes(1);
  });
});
