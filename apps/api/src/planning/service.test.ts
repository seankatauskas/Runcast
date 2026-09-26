import { planningBundleV3Schema } from '@runcast/contracts';
import {
  FORECAST_FRESHNESS_MS,
  contentIdentity,
  type NormalizedRouteForecast,
  type ForecastVariable,
  type CanopyEvidenceProfile,
} from '@runcast/core';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors';
import { planningBundleRoutes } from '../routes/planning';
import { preparedRouteForecastFromForecast, type PreparedRouteForecast } from './bundle';
import {
  PlanningBundleService,
  ForecastPreparationCoordinator,
  type RouteForecastPreparer,
  type OwnedPlanningRouteRecord,
  type RouteForecastRepository,
} from './service';
import type { RouteCanopyPreparer, RouteCanopyRepository } from './canopy';

const NOW = Date.now();
const VARIABLES: ForecastVariable[] = [
  'temperatureC',
  'feelsLikeC',
  'humidityPct',
  'windSpeedMs',
  'windDirectionFromDeg',
  'gustMs',
  'cloudCoverPct',
  'precipitationProbabilityPct',
  'precipitationMm',
  'weatherCode',
  'shortwaveRadiationWm2',
  'directNormalRadiationWm2',
  'diffuseRadiationWm2',
];

function forecast(fetchedAt = NOW - 60_000): NormalizedRouteForecast {
  const values = Object.fromEntries(VARIABLES.map((variable) => [variable, [1, 1]])) as Record<
    ForecastVariable,
    number[]
  >;
  const variables = Object.fromEntries(
    VARIABLES.map((variable) => [
      variable,
      {
        semantics: 'instant' as const,
        unit: 'fixture',
        validRange: [-100, 2_000] as const,
        required: true,
      },
    ]),
  ) as NormalizedRouteForecast['variables'];
  const body = {
    schemaVersion: 2 as const,
    normalizationVersion: 'fixture-v2',
    provider: 'fixture',
    providerModel: null,
    providerRun: null,
    fetchId: 'fetch',
    fetchedAt,
    validFrom: NOW - 3_600_000,
    validUntil: NOW + 3_600_000,
    requestedCoordinates: [{ lat: 41.9, lon: -87.6 }],
    returnedCoordinates: [{ lat: 41.9, lon: -87.6 }],
    variables,
    anchors: [
      {
        routeDistanceM: 0,
        lat: 41.9,
        lon: -87.6,
        hourly: { time: [NOW - 3_600_000, NOW + 3_600_000], values },
      },
    ],
    missingCounts: Object.fromEntries(VARIABLES.map((variable) => [variable, 0])) as Record<
      ForecastVariable,
      number
    >,
    reasons: [],
  };
  return { ...body, contentHash: contentIdentity(body) };
}

const route: OwnedPlanningRouteRecord = {
  id: 'route-1',
  ownerId: 'owner-1',
  timezone: 'America/Chicago',
  coordinateHash: 'route-fixture',
  planningRoute: null,
  route: {
    id: 'route-1',
    name: 'Legacy route',
    points: [
      { lat: 41.9, lon: -87.6, ele: 0 },
      { lat: 41.91, lon: -87.59, ele: 1 },
    ],
    cumulative: [0, 1_000],
    totalDistance: 1_000,
  },
  coverage: { resolution: 50, values: ['tree', 'open', 'unknown'] },
};

class FakeRepository implements RouteForecastRepository {
  preparedForecast: PreparedRouteForecast | null = preparedRouteForecastFromForecast(
    forecast(),
    route.timezone,
  );
  leaseAvailable = true;
  requestedOwners: string[] = [];
  released = 0;
  leaseAttempts = 0;

  async findOwnedRoute(ownerId: string, routeId: string) {
    this.requestedOwners.push(ownerId);
    return ownerId === route.ownerId && routeId === route.id ? route : null;
  }
  async findPreparedForecast() {
    return this.preparedForecast;
  }
  async tryAcquireLease() {
    this.leaseAttempts += 1;
    return this.leaseAvailable;
  }
  async savePreparedForecast(
    _routeId: string,
    _holder: string,
    preparedForecast: PreparedRouteForecast,
  ) {
    this.preparedForecast = preparedForecast;
  }
  async releaseLease() {
    this.released += 1;
  }
}

const successfulPreparer: RouteForecastPreparer = {
  prepare: async () => preparedRouteForecastFromForecast(forecast(), route.timezone),
};

const canopyProfile: CanopyEvidenceProfile = {
  schemaVersion: 3,
  routeDistanceM: [0, 1_000],
  canopyPct: [45, 60],
  standardErrorPct: [5, 6],
  provider: 'usda-fs-science-tcc',
  region: 'conus',
  datasetYear: 2025,
  datasetVersion: 'v2025-6',
  sourceResolutionM: 30,
  acquiredAt: NOW,
  coordinateHash: route.coordinateHash,
  completeness: 'complete',
  reasons: [],
};

class FakeCanopyRepository implements RouteCanopyRepository {
  profile: CanopyEvidenceProfile | null = canopyProfile;
  leaseAttempts = 0;

  async find() {
    return this.profile;
  }
  async tryAcquireLease() {
    this.leaseAttempts += 1;
    return this.profile === null;
  }
  async save(_route: OwnedPlanningRouteRecord, _holder: string, profile: CanopyEvidenceProfile) {
    this.profile = profile;
  }
  async fail() {}
  async release() {}
}

const successfulCanopyPreparer: RouteCanopyPreparer = {
  prepare: async () => canopyProfile,
};

async function testApp(service: PlanningBundleService, authenticatedOwner = route.ownerId) {
  const app = Fastify();
  await planningBundleRoutes(app, service, async (request) => {
    request.auth = { userId: authenticatedOwner, deviceId: 'device', sessionId: 'session' };
  });
  app.setErrorHandler((error, request, reply) => {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(500, 'INTERNAL_ERROR', 'Unexpected test error');
    return reply.code(appError.statusCode).send({
      error: { code: appError.code, message: appError.message, requestId: request.id },
    });
  });
  return app;
}

const compatibilityHeaders = {
  'x-runcast-bundle-reader': '3',
  'x-runcast-evaluator-build': 'mobile-fixture',
};

describe('planning bundle service and endpoint', () => {
  it('serves reader 3 and rejects retired reader 2', async () => {
    const canopyRepository = new FakeCanopyRepository();
    const app = await testApp(
      new PlanningBundleService(
        new FakeRepository(),
        successfulPreparer,
        canopyRepository,
        successfulCanopyPreparer,
        'active',
      ),
    );
    const oldReader = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: { ...compatibilityHeaders, 'x-runcast-bundle-reader': '2' },
    });
    expect(oldReader.statusCode).toBe(426);

    const currentReader = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: {
        ...compatibilityHeaders,
        'x-runcast-bundle-reader': '3',
      },
    });
    expect(currentReader.statusCode).toBe(200);
    expect(planningBundleV3Schema.parse(currentReader.json())).toMatchObject({
      manifest: { bundleSchemaVersion: 3, canopyModelMode: 'active' },
      environment: { canopy: { coordinateHash: route.coordinateHash } },
    });
    await app.close();
  });

  it('serves unknown/open-sky V3 immediately while lazily enriching a saved route', async () => {
    const canopyRepository = new FakeCanopyRepository();
    canopyRepository.profile = null;
    const prepare = vi.fn(successfulCanopyPreparer.prepare);
    const app = await testApp(
      new PlanningBundleService(
        new FakeRepository(),
        successfulPreparer,
        canopyRepository,
        { prepare },
        'active',
      ),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: {
        ...compatibilityHeaders,
        'x-runcast-bundle-reader': '3',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(planningBundleV3Schema.parse(response.json()).environment.canopy).toMatchObject({
      completeness: 'unavailable',
    });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await app.close();
  });

  it('requires compatible reader headers before route lookup', async () => {
    const repository = new FakeRepository();
    const app = await testApp(new PlanningBundleService(repository, successfulPreparer));
    const response = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
    });
    expect(response.statusCode).toBe(426);
    expect(response.json().error.code).toBe('CLIENT_UPDATE_REQUIRED');
    expect(repository.requestedOwners).toEqual([]);
    await app.close();
  });

  it('returns a strict degraded legacy bundle and compatibility-varied ETag', async () => {
    const repository = new FakeRepository();
    const app = await testApp(new PlanningBundleService(repository, successfulPreparer));
    const first = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers.vary).toBe('X-Runcast-Bundle-Reader, X-Runcast-Evaluator-Build');
    expect(first.headers.etag).toBeTruthy();
    const bundle = planningBundleV3Schema.parse(first.json());
    expect(bundle.manifest.state).toBe('degraded');
    expect(bundle.manifest.generatedAt).toBe(new Date(forecast().fetchedAt).toISOString());
    expect(new Set(bundle.environment.coverage.values)).toEqual(new Set(['unknown']));

    const changedBuild = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: { ...compatibilityHeaders, 'x-runcast-evaluator-build': 'other-build' },
    });
    expect(changedBuild.headers.etag).not.toBe(first.headers.etag);
    await app.close();
  });

  it('returns 304 only for a matching compatibility-specific ETag', async () => {
    const app = await testApp(new PlanningBundleService(new FakeRepository(), successfulPreparer));
    const first = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    const second = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: { ...compatibilityHeaders, 'if-none-match': first.headers.etag! },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    await app.close();
  });

  it('returns 202 during preparation and promotes the completed artifact', async () => {
    const repository = new FakeRepository();
    repository.preparedForecast = null;
    const service = new PlanningBundleService(repository, successfulPreparer);
    const app = await testApp(service);
    const first = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(first.statusCode).toBe(202);
    expect(first.headers['retry-after']).toBe('5');
    await vi.waitFor(() => expect(repository.released).toBe(1));
    const ready = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(ready.statusCode).toBe(200);
    await app.close();
  });

  it('serves a stale valid artifact while starting only one background preparation', async () => {
    const repository = new FakeRepository();
    repository.preparedForecast = preparedRouteForecastFromForecast(
      forecast(NOW - FORECAST_FRESHNESS_MS - 1),
      route.timezone,
    );
    let finishPreparation: ((preparedForecast: PreparedRouteForecast) => void) | undefined;
    const prepare = vi.fn(
      () =>
        new Promise<PreparedRouteForecast>((resolve) => {
          finishPreparation = resolve;
        }),
    );
    const app = await testApp(new PlanningBundleService(repository, { prepare }));

    const first = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    const concurrent = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: { ...compatibilityHeaders, 'if-none-match': first.headers.etag! },
    });
    expect(first.statusCode).toBe(200);
    expect(concurrent.statusCode).toBe(304);
    expect(planningBundleV3Schema.parse(first.json()).forecast.data.fetchedAt).toBe(
      NOW - FORECAST_FRESHNESS_MS - 1,
    );
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(repository.leaseAttempts).toBe(1);

    finishPreparation?.(preparedRouteForecastFromForecast(forecast(NOW), route.timezone));
    await vi.waitFor(() => expect(repository.released).toBe(1));
    await app.close();
  });

  it('respects a competing lease and suppresses repeated work after a stale refresh failure', async () => {
    const leasedRepository = new FakeRepository();
    leasedRepository.preparedForecast = preparedRouteForecastFromForecast(
      forecast(NOW - FORECAST_FRESHNESS_MS - 1),
      route.timezone,
    );
    leasedRepository.leaseAvailable = false;
    const leasedPrepare = vi.fn(successfulPreparer.prepare);
    const leasedApp = await testApp(
      new PlanningBundleService(leasedRepository, { prepare: leasedPrepare }),
    );
    const leasedResponse = await leasedApp.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(leasedResponse.statusCode).toBe(200);
    await vi.waitFor(() => expect(leasedRepository.leaseAttempts).toBe(1));
    expect(leasedPrepare).not.toHaveBeenCalled();
    await leasedApp.close();

    const failedRepository = new FakeRepository();
    failedRepository.preparedForecast = preparedRouteForecastFromForecast(
      forecast(NOW - FORECAST_FRESHNESS_MS - 1),
      route.timezone,
    );
    const failedPrepare = vi.fn(async () => Promise.reject(new Error('provider down')));
    const failedApp = await testApp(
      new PlanningBundleService(failedRepository, { prepare: failedPrepare }),
    );
    const first = await failedApp.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => expect(failedRepository.released).toBe(1));
    const second = await failedApp.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(second.statusCode).toBe(200);
    expect(failedPrepare).toHaveBeenCalledTimes(1);
    await failedApp.close();
  });

  it('serves a freshly prepared artifact on the next targeted request', async () => {
    const repository = new FakeRepository();
    repository.preparedForecast = preparedRouteForecastFromForecast(
      forecast(NOW - FORECAST_FRESHNESS_MS - 1),
      route.timezone,
    );
    const app = await testApp(
      new PlanningBundleService(repository, {
        prepare: async () => preparedRouteForecastFromForecast(forecast(NOW), route.timezone),
      }),
    );
    const stale = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(stale.statusCode).toBe(200);
    await vi.waitFor(() => expect(repository.released).toBe(1));

    const fresh = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: { ...compatibilityHeaders, 'if-none-match': stale.headers.etag! },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers.etag).not.toBe(stale.headers.etag);
    expect(planningBundleV3Schema.parse(fresh.json()).forecast.data.fetchedAt).toBe(NOW);
    await app.close();
  });

  it('returns 503 after provider failure and 404 outside owner scope', async () => {
    const repository = new FakeRepository();
    repository.preparedForecast = null;
    const failing: RouteForecastPreparer = {
      prepare: async () => Promise.reject(new Error('down')),
    };
    const service = new PlanningBundleService(repository, failing);
    const app = await testApp(service);
    const first = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(() => expect(repository.released).toBe(1));
    const unavailable = await app.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe('FORECAST_UNAVAILABLE');

    const otherApp = await testApp(service, 'different-owner');
    const notFound = await otherApp.inject({
      method: 'GET',
      url: `/v2/routes/${route.id}/planning-bundle`,
      headers: compatibilityHeaders,
    });
    expect(notFound.statusCode).toBe(404);
    await otherApp.close();
    await app.close();
  });
});

describe('forecast preparation lifecycle', () => {
  it('handles lease acquisition failures for detached preparation and preserves cached data', async () => {
    const repository = new FakeRepository();
    const prepare = vi.fn(successfulPreparer.prepare);
    vi.spyOn(repository, 'tryAcquireLease').mockRejectedValue(new Error('database unavailable'));
    const coordinator = new ForecastPreparationCoordinator(repository, { prepare });
    coordinator.start(route, NOW);
    await expect(coordinator.close()).resolves.toBe(true);
    expect(coordinator.recentlyFailed(route.id, Date.now())).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(repository.released).toBe(0);
    expect(repository.preparedForecast).not.toBeNull();
  });

  it('contains release failures after a successful save', async () => {
    const repository = new FakeRepository();
    vi.spyOn(repository, 'releaseLease').mockRejectedValue(new Error('database unavailable'));
    const coordinator = new ForecastPreparationCoordinator(repository, successfulPreparer);
    await expect(coordinator.prepareAndWait(route, NOW)).resolves.toEqual(
      repository.preparedForecast,
    );
    expect(coordinator.isPreparing(route.id)).toBe(false);
    await expect(coordinator.close()).resolves.toBe(true);
  });

  it('abandons late provider results without touching the database after shutdown times out', async () => {
    const repository = new FakeRepository();
    const save = vi.spyOn(repository, 'savePreparedForecast');
    const read = vi.spyOn(repository, 'findPreparedForecast');
    let finish!: (value: PreparedRouteForecast) => void;
    const prepare = vi.fn(
      () =>
        new Promise<PreparedRouteForecast>((resolve) => {
          finish = resolve;
        }),
    );
    const coordinator = new ForecastPreparationCoordinator(repository, { prepare });
    const work = coordinator.prepareAndWait(route, NOW);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await expect(coordinator.close(1)).resolves.toBe(false);
    finish(repository.preparedForecast!);
    await expect(work).resolves.toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(repository.released).toBe(0);
    await expect(coordinator.prepareAndWait(route, NOW)).resolves.toBeNull();
  });
});
