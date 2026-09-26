import { describe, expect, it, vi } from 'vitest';
import { adaptLegacyRoute } from '@runcast/core';
import { DEMO_ROUTES } from '@runcast/core';
import {
  acquireCanopyEvidence,
  canopyRegionForRoute,
  canopyValue,
  interpolateCanopyRoutePoints,
  resolvePinnedCanopyCatalog,
  standardErrorValue,
  USDA_CANOPY_SAMPLE_LIMIT,
} from './usdaCanopy';

describe('USDA canopy provider', () => {
  it('pins the catalog year, version, and resolution', () => {
    expect(
      resolvePinnedCanopyCatalog({
        serviceDescription: 'Science TCC v2025-6',
        timeInfo: { timeExtent: [Date.UTC(1985, 0, 1), Date.UTC(2025, 0, 1)] },
        pixelSizeX: 30,
        maxRecordCount: 1_000,
      }),
    ).toEqual({ datasetYear: 2025, datasetVersion: 'v2025-6', sourceResolutionM: 30 });
    expect(() =>
      resolvePinnedCanopyCatalog({
        serviceDescription: 'latest',
        timeInfo: { timeExtent: [0, Date.UTC(2025, 0, 1)] },
        pixelSizeX: 30,
      }),
    ).toThrow();
  });

  it('converts units and documented mask/background sentinels', () => {
    expect(canopyValue('63')).toBe(63);
    expect(canopyValue(254)).toBeNull();
    expect(canopyValue(255)).toBeNull();
    expect(standardErrorValue('725')).toBe(7.25);
    expect(standardErrorValue(65_534)).toBeNull();
    expect(standardErrorValue(65_535)).toBeNull();
  });

  it('classifies supported demos and interpolates no farther than 30 m', () => {
    const route = adaptLegacyRoute(DEMO_ROUTES[0].route);
    expect(canopyRegionForRoute(route)).toBe('conus');
    const points = interpolateCanopyRoutePoints(route);
    expect(points.at(-1)?.distanceM).toBeCloseTo(route.totalDistanceM);
    expect(points[1].distanceM - points[0].distanceM).toBeLessThanOrEqual(30);
  });

  it('pairs partial responses by location ID and retries failures', async () => {
    const route = adaptLegacyRoute(DEMO_ROUTES[0].route);
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls += 1;
      if (calls <= 2) throw new Error('temporary');
      const geometry = JSON.parse(new URL(String(url)).searchParams.get('geometry')!);
      const standardError = String(url).includes('Science_SE');
      return new Response(
        JSON.stringify({
          samples: geometry.points.flatMap((_: unknown, index: number) =>
            index === 1 ? [] : [{ locationId: index + 1, value: standardError ? '500' : '60' }],
          ),
        }),
        { status: 200 },
      );
    });
    const profile = await acquireCanopyEvidence(route, 'geometry', {
      fetchImpl: fetchImpl as typeof fetch,
      retries: 2,
      acquiredAt: 123,
    });
    expect(profile.completeness).toBe('partial');
    expect(profile.canopyPct[0]).toBe(60);
    expect(profile.standardErrorPct[0]).toBe(5);
    expect(profile.canopyPct[1]).toBeNull();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('batches requests at no more than 1,000 points', async () => {
    const source = adaptLegacyRoute(DEMO_ROUTES[0].route);
    const route = { ...source, totalDistanceM: USDA_CANOPY_SAMPLE_LIMIT * 30 + 1 };
    route.cumulativeDistanceM = [0, route.totalDistanceM];
    route.part = { points: [source.part.points[0], source.part.points.at(-1)!] };
    const sizes: number[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const geometry = JSON.parse(new URL(String(url)).searchParams.get('geometry')!);
      sizes.push(geometry.points.length);
      return new Response(
        JSON.stringify({
          samples: geometry.points.map((_: unknown, index: number) => ({
            locationId: index + 1,
            value: String(url).includes('Science_SE') ? '100' : '10',
          })),
        }),
        { status: 200 },
      );
    });
    await acquireCanopyEvidence(route, 'geometry', { fetchImpl: fetchImpl as typeof fetch });
    expect(Math.max(...sizes)).toBeLessThanOrEqual(USDA_CANOPY_SAMPLE_LIMIT);
    expect(sizes.length).toBeGreaterThan(2);
  });

  it('returns explicit unknown evidence without a provider call outside supported regions', async () => {
    const source = adaptLegacyRoute(DEMO_ROUTES[0].route);
    const unsupported = {
      ...source,
      part: {
        points: source.part.points.map((point, index) => ({
          ...point,
          lat: 51 + index * 0.001,
          lon: 0,
        })),
      },
    };
    const fetchImpl = vi.fn();
    const profile = await acquireCanopyEvidence(unsupported, 'unsupported-geometry', {
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(profile).toMatchObject({
      region: 'unsupported',
      completeness: 'unavailable',
      reasons: ['canopy.unavailable', 'canopy.unsupported-region'],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancels active requests without retrying when preparation shuts down', async () => {
    const route = adaptLegacyRoute(DEMO_ROUTES[0].route);
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const work = acquireCanopyEvidence(route, 'geometry', {
      fetchImpl: fetchImpl as typeof fetch,
      signal: controller.signal,
      retries: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses provider work when preparation was already cancelled', async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      acquireCanopyEvidence(adaptLegacyRoute(DEMO_ROUTES[0].route), 'geometry', {
        fetchImpl: fetchImpl as typeof fetch,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts timed-out requests', async () => {
    const route = adaptLegacyRoute(DEMO_ROUTES[0].route);
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Timed out', 'AbortError')),
          );
        }),
    );
    await expect(
      acquireCanopyEvidence(route, 'geometry', {
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 1,
        retries: 0,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
