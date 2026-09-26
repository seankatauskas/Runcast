import { forecastIsFresh } from '@runcast/core';
import type { CachedPlanningBundle } from './planningBundle';

export type PlanningBundleHttpResult =
  | { status: 'modified'; body: string; etag: string }
  | { status: 'not-modified'; etag: string | null }
  | { status: 'preparing'; retryAfterSeconds: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'update-required'; reason: string };

export type PlanningBundleSyncState = PlanningBundleHttpResult['status'];

export interface PlanningBundleSyncResult {
  state: PlanningBundleSyncState;
  cached: CachedPlanningBundle | null;
  retryAfterSeconds?: number;
  reasons: string[];
}

export interface PlanningBundleSyncDependencies {
  read(): Promise<CachedPlanningBundle | null>;
  request(etag?: string): Promise<PlanningBundleHttpResult>;
  promote(body: string, etag: string): Promise<CachedPlanningBundle>;
}

/** Conditional refresh that never discards the last verified compatible row. */
export async function syncPlanningBundle(
  dependencies: PlanningBundleSyncDependencies,
): Promise<PlanningBundleSyncResult> {
  const prior = await dependencies.read();
  let response: PlanningBundleHttpResult;
  try {
    response = await dependencies.request(prior?.etag);
  } catch {
    return {
      state: 'unavailable',
      cached: prior,
      reasons: ['bundle.refresh-failed'],
    };
  }
  switch (response.status) {
    case 'modified':
      try {
        return {
          state: 'modified',
          cached: await dependencies.promote(response.body, response.etag),
          reasons: [],
        };
      } catch (error) {
        return {
          state: 'unavailable',
          cached: prior,
          reasons: [
            error instanceof Error && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'bundle.invalid-response',
          ],
        };
      }
    case 'not-modified':
      return prior
        ? { state: 'not-modified', cached: prior, reasons: [] }
        : {
            state: 'unavailable',
            cached: null,
            reasons: ['bundle.not-modified-without-cache'],
          };
    case 'preparing':
      return {
        state: 'preparing',
        cached: prior,
        retryAfterSeconds: response.retryAfterSeconds,
        reasons: ['bundle.preparing'],
      };
    case 'update-required':
      return {
        state: 'update-required',
        cached: prior,
        reasons: ['compatibility.reader-unsupported'],
      };
    case 'unavailable':
      return {
        state: 'unavailable',
        cached: prior,
        reasons: ['recommendation.input-unavailable'],
      };
  }
}

export interface PlanningBundleRefreshOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

/**
 * Poll a targeted bundle while the server prepares stale data. Network and
 * validation failures stop immediately so the next clock boundary can retry.
 */
export async function refreshPlanningBundleUntilFresh(
  dependencies: PlanningBundleSyncDependencies,
  options: PlanningBundleRefreshOptions = {},
): Promise<PlanningBundleSyncResult> {
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  let result: PlanningBundleSyncResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    result = await syncPlanningBundle(dependencies);
    const fetchedAt = result.cached?.bundle.forecast.data.fetchedAt;
    if (fetchedAt !== undefined && forecastIsFresh(fetchedAt, now())) return result;
    if (result.state === 'unavailable' || result.state === 'update-required') return result;
    if (attempt < maxRetries) await sleep(retryDelayMs);
  }

  return result!;
}
