import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeValidWeatherPayload } from '../test-fixtures/weather-fixtures';
import type { PlanningRoute } from '../engine/planning/types';
import { fetchNormalizedRouteForecast } from './openMeteo';

afterEach(() => vi.unstubAllGlobals());

const route: PlanningRoute = {
  schemaVersion: 2,
  id: 'route',
  name: 'Route',
  part: {
    points: [
      { lat: 41.9, lon: -87.6, elevationM: 0 },
      { lat: 41.91, lon: -87.59, elevationM: 0 },
    ],
  },
  cumulativeDistanceM: [0, 1_500],
  totalDistanceM: 1_500,
  quality: {
    schemaVersion: 2,
    trackCount: 1,
    trackSegmentCount: 1,
    routeCount: 0,
    invalidPointCount: 0,
    duplicatePointCount: 0,
    missingElevationCount: 0,
    elevationStatus: 'complete',
    reasons: [],
  },
};

describe('normalized route forecast acquisition', () => {
  it('requests radiation and passes the untouched response through pure normalization', async () => {
    const first = makeValidWeatherPayload();
    const second = makeValidWeatherPayload();
    second.latitude = 41.91;
    second.longitude = -87.59;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([first, second]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchNormalizedRouteForecast(route);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('shortwave_radiation');
    expect(url).toContain('direct_normal_irradiance');
    expect(url).toContain('diffuse_radiation');
    expect(result.field.anchors).toHaveLength(2);
    expect(result.field.anchors[0].hourly.values.precipitationProbabilityPct[0]).toBeNull();
  });

  it('supports a development provider bridge without changing request semantics', async () => {
    const first = makeValidWeatherPayload();
    const second = makeValidWeatherPayload();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([first, second]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchNormalizedRouteForecast(route, undefined, 'http://127.0.0.1:8098/v1/forecast');

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^http:\/\/127\.0\.0\.1:8098\/v1\/forecast\?/,
    );
  });

  it('reports a non-JSON provider response with actionable context', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('Upstream connection unavailable', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNormalizedRouteForecast(route)).rejects.toThrow(
      'Open-Meteo returned invalid JSON (text/plain): Upstream connection unavailable',
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2][0])).toContain('models=ecmwf_ifs025');
  });

  it('retries a transient provider failure before returning normalized data', async () => {
    const first = makeValidWeatherPayload();
    const second = makeValidWeatherPayload();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([first, second]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchNormalizedRouteForecast(route);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.field.anchors).toHaveLength(2);
  });

  it('falls back to an explicit model when automatic model selection remains unavailable', async () => {
    const first = makeValidWeatherPayload();
    const second = makeValidWeatherPayload();
    second.latitude = 41.91;
    second.longitude = -87.59;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([first, second]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchNormalizedRouteForecast(route);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('models=');
    expect(String(fetchMock.mock.calls[2][0])).toContain('models=ecmwf_ifs025');
    expect(result.field.providerModel).toBe('ecmwf_ifs025');
    expect(result.field.anchors).toHaveLength(2);
  });

  it('chunks a long route only when the automatic batch is unavailable', async () => {
    const longRoute: PlanningRoute = {
      ...route,
      part: {
        points: [route.part.points[0], route.part.points[1]],
      },
      cumulativeDistanceM: [0, 7_500],
      totalDistanceM: 7_500,
    };
    const payload = () => makeValidWeatherPayload();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([payload(), payload()]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([payload(), payload()]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchNormalizedRouteForecast(longRoute);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('latitude')?.split(','),
    ).toHaveLength(4);
    expect(
      new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('latitude')?.split(','),
    ).toHaveLength(2);
    expect(
      new URL(String(fetchMock.mock.calls[3][0])).searchParams.get('latitude')?.split(','),
    ).toHaveLength(2);
    expect(result.field.providerModel).toBe('ecmwf_ifs025');
    expect(result.field.anchors).toHaveLength(4);
  });
});
