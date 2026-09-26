import { adaptLegacyRoute, DEMO_ROUTES, parsePlanningGpx } from '@runcast/core';
import { describe, expect, it, vi } from 'vitest';
import {
  E2E_GPX,
  E2E_GPX_FILENAME,
  E2E_ROUTE_ID,
  createRouteForecastFetcher,
  deterministicForecastEnabled,
  e2eBuildEnabled,
  e2eRouteIdForImport,
} from './runtime';

const route = { ...adaptLegacyRoute(DEMO_ROUTES[0].route), id: E2E_ROUTE_ID };

describe('E2E runtime guard', () => {
  it('requires the isolated environment and explicit build mode together', () => {
    expect(e2eBuildEnabled({ appEnvironment: 'e2e', mode: 'enabled' })).toBe(true);
    expect(e2eBuildEnabled({ appEnvironment: 'production', mode: 'enabled' })).toBe(false);
    expect(e2eBuildEnabled({ appEnvironment: 'e2e', mode: undefined })).toBe(false);
  });

  it('delegates every production request to the live client', async () => {
    const liveResult = { field: { source: 'live' }, timezone: 'UTC' };
    const liveFetcher = vi.fn(async () => liveResult);
    const fetcher = createRouteForecastFetcher(false, {
      liveFetcher: liveFetcher as never,
    });

    await expect(fetcher(route)).resolves.toBe(liveResult);
    expect(liveFetcher).toHaveBeenCalledOnce();
  });

  it('lets an isolated simulator opt into an explicit live provider', () => {
    expect(
      deterministicForecastEnabled({
        e2eBuild: true,
        providerBaseUrl: 'http://127.0.0.1:8098/v1/forecast',
      }),
    ).toBe(false);
    expect(deterministicForecastEnabled({ e2eBuild: true, providerBaseUrl: undefined })).toBe(true);
    expect(deterministicForecastEnabled({ e2eBuild: false, providerBaseUrl: undefined })).toBe(
      false,
    );
  });

  it('assigns a stable ID only to the exact isolated GPX fixture', () => {
    expect(e2eRouteIdForImport(E2E_GPX, E2E_GPX_FILENAME, true)).toBe(E2E_ROUTE_ID);
    expect(e2eRouteIdForImport(E2E_GPX, 'runner-route.gpx', true)).toBeNull();
    expect(e2eRouteIdForImport(E2E_GPX, E2E_GPX_FILENAME, false)).toBeNull();
    expect(parsePlanningGpx(E2E_GPX, E2E_ROUTE_ID, 'fallback').name).toBe('Maestro Lake Loop');
  });

  it('fails the fixture once, then returns a valid deterministic forecast without live IO', async () => {
    const liveFetcher = vi.fn();
    const fetcher = createRouteForecastFetcher(true, {
      liveFetcher,
      now: () => Date.UTC(2026, 7, 15, 12),
    });

    await expect(fetcher(route)).rejects.toThrow('E2E forecast provider unavailable');
    const retry = await fetcher(route);

    expect(liveFetcher).not.toHaveBeenCalled();
    expect(retry.timezone).toBe('America/Chicago');
    expect(retry.field.schemaVersion).toBe(2);
    expect(retry.field.fetchId).toHaveLength(64);
    expect(retry.field.anchors).toHaveLength(2);
  });
});
