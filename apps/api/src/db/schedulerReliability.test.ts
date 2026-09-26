import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  contentIdentity,
  parseGpx,
  parsePlanningGpx,
  unknownLegacyCoverageMask,
  type ForecastVariable,
  type NormalizedRouteForecast,
  type CanopyEvidenceProfile,
} from '@runcast/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpoTicket } from '../providers/expo';

const expo = vi.hoisted(() => ({
  send: vi.fn<(...args: unknown[]) => Promise<ExpoTicket>>(),
  receipts: vi.fn(),
}));
vi.mock('../providers/expo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../providers/expo')>()),
  sendExpoPush: expo.send,
  fetchExpoReceipts: expo.receipts,
}));

import { config } from '../config';
import { runScheduler } from '../jobs/scheduler';
import { preparedRouteForecastFromForecast } from '../planning/bundle';
import { CanopyPreparationCoordinator, unknownCanopyForRoute } from '../planning/canopy';
import * as evaluations from '../planning/evaluations';
import { OpenMeteoRouteForecastPreparer, UsdaRouteCanopyPreparer } from '../planning/runtime';
import { ForecastPreparationCoordinator } from '../planning/service';
import { closeDatabase, db, sql } from './client';
import {
  deviceInstallations,
  notificationDeliveries,
  notificationPublications,
  recommendationEvaluations,
  routes,
  users,
  watches,
} from './schema';

const integration = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;
const ownerIds: string[] = [];
const now = new Date('2026-09-19T05:00:00.000Z');
const originalCanopyMode = config.canopyModelMode;
const originalRevisionMode = config.watchRevisionMode;

function forecast(): NormalizedRouteForecast {
  const names: ForecastVariable[] = [
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
  const values = Object.fromEntries(names.map((name) => [name, [1, 1]])) as Record<
    ForecastVariable,
    number[]
  >;
  const variables = Object.fromEntries(
    names.map((name) => [
      name,
      {
        semantics: 'instant',
        unit: 'fixture',
        validRange: [-100, 2_000],
        required: true,
      },
    ]),
  ) as unknown as NormalizedRouteForecast['variables'];
  const body = {
    schemaVersion: 2 as const,
    normalizationVersion: 'scheduler-reliability-fixture',
    provider: 'fixture',
    providerModel: null,
    providerRun: null,
    fetchId: 'scheduler-fixture',
    fetchedAt: now.getTime(),
    validFrom: now.getTime() - 60_000,
    validUntil: now.getTime() + 4 * 3_600_000,
    requestedCoordinates: [{ lat: 41, lon: -87 }],
    returnedCoordinates: [{ lat: 41, lon: -87 }],
    variables,
    anchors: [
      {
        routeDistanceM: 0,
        lat: 41,
        lon: -87,
        hourly: { time: [now.getTime() - 60_000, now.getTime() + 4 * 3_600_000], values },
      },
    ],
    missingCounts: Object.fromEntries(names.map((name) => [name, 0])) as Record<
      ForecastVariable,
      number
    >,
    reasons: [],
  };
  return { ...body, contentHash: contentIdentity(body) };
}

async function fixture() {
  const [owner] = await db.insert(users).values({}).returning();
  ownerIds.push(owner.id);
  const routeId = randomUUID();
  const xml =
    '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>0</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
  const route = parseGpx(xml, routeId, 'Scheduler reliability');
  const planningRoute = parsePlanningGpx(xml, routeId, route.name);
  await db.insert(routes).values({
    id: routeId,
    ownerId: owner.id,
    source: 'gpx',
    canonicalRoute: route,
    canonicalRouteV2: planningRoute,
    routeQualityV2: planningRoute.quality,
    v2ContentIdentity: contentIdentity(planningRoute),
    name: route.name,
    distance: route.totalDistance,
    coverageMask: unknownLegacyCoverageMask(route),
    coordinateHash: randomUUID(),
    timezone: 'UTC',
  });
  const [watch] = await db
    .insert(watches)
    .values({
      userId: owner.id,
      routeId,
      weekdays: 127,
      timezone: 'UTC',
      startMinutes: 360,
      endMinutes: 420,
      speed: 3,
      leadMinutes: 60,
    })
    .returning();
  const [device] = await db
    .insert(deviceInstallations)
    .values({
      userId: owner.id,
      deviceId: randomUUID(),
      expoPushToken: `ExponentPushToken[${randomUUID()}]`,
      platform: 'ios',
      appVersion: 'test',
    })
    .returning();
  return { routeId, watch, device };
}

integration('scheduler failure isolation and shutdown', () => {
  beforeEach(() => {
    Object.assign(config, { canopyModelMode: 'off', watchRevisionMode: 'off' });
    expo.send.mockReset().mockResolvedValue({ status: 'ok', id: `ticket-${randomUUID()}` });
    expo.receipts.mockReset().mockResolvedValue({});
    vi.spyOn(OpenMeteoRouteForecastPreparer.prototype, 'prepare').mockResolvedValue(
      preparedRouteForecastFromForecast(forecast(), 'UTC'),
    );
    vi.spyOn(UsdaRouteCanopyPreparer.prototype, 'prepare').mockImplementation(async (route) =>
      unknownCanopyForRoute(route),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    Object.assign(config, {
      canopyModelMode: originalCanopyMode,
      watchRevisionMode: originalRevisionMode,
    });
    if (ownerIds.length) await db.delete(users).where(inArray(users.id, ownerIds.splice(0)));
  });
  afterAll(closeDatabase);

  it('still prepares, evaluates, publishes and sends when receipt reconciliation fails', async () => {
    const f = await fixture();
    await db.insert(notificationDeliveries).values({
      watchId: f.watch.id,
      deviceId: f.device.id,
      occurrenceDate: '2026-09-18',
      ticketState: 'ok',
      ticketId: 'old-ticket-awaiting-receipt',
      attempts: 1,
      sentAt: new Date(now.getTime() - 10 * 60_000),
    });
    expo.receipts.mockRejectedValue(new Error('receipt provider unavailable'));
    const forecastClose = vi.spyOn(ForecastPreparationCoordinator.prototype, 'close');
    const canopyClose = vi.spyOn(CanopyPreparationCoordinator.prototype, 'close');
    const result = await runScheduler(now, () => now);
    expect(result).toMatchObject({
      acquired: true,
      evaluated: 1,
      evaluationFailures: 0,
      phaseFailures: ['receipts'],
      deliveries: { accepted: 1 },
    });
    expect(OpenMeteoRouteForecastPreparer.prototype.prepare).toHaveBeenCalledOnce();
    expect(expo.send).toHaveBeenCalledOnce();
    expect(expo.receipts).toHaveBeenCalledWith(['old-ticket-awaiting-receipt']);
    expect(
      await db
        .select()
        .from(notificationPublications)
        .where(eq(notificationPublications.watchId, f.watch.id)),
    ).toHaveLength(1);
    expect(forecastClose).toHaveBeenCalledOnce();
    expect(canopyClose).toHaveBeenCalledOnce();
  });

  it('cancels legacy retries at cutover and does not republish an already accepted legacy occurrence', async () => {
    const f = await fixture();
    await db.insert(notificationDeliveries).values([
      {
        watchId: f.watch.id,
        deviceId: f.device.id,
        occurrenceDate: '2026-09-17',
        ticketState: 'pending',
      },
      {
        watchId: f.watch.id,
        deviceId: f.device.id,
        occurrenceDate: '2026-09-18',
        ticketState: 'retryable-error',
        attempts: 1,
      },
      {
        watchId: f.watch.id,
        deviceId: f.device.id,
        occurrenceDate: '2026-09-19',
        ticketState: 'ok',
        ticketId: 'accepted-legacy',
        attempts: 1,
        sentAt: now,
      },
    ]);
    const migration = await readFile(
      new URL('../../migrations/0014_retire_legacy_planning.sql', import.meta.url),
      'utf8',
    );
    await sql.unsafe(migration);
    const result = await runScheduler(now, () => now);
    expect(result).toMatchObject({ mode: 'current', evaluated: 1, deliveries: { attempted: 0 } });
    expect(expo.send).not.toHaveBeenCalled();
    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.watchId, f.watch.id));
    expect(rows.map((row) => row.ticketState).sort()).toEqual(['cancelled', 'cancelled', 'ok']);
    expect(rows.find((row) => row.ticketState === 'ok')?.ticketId).toBe('accepted-legacy');
    expect(
      await db
        .select()
        .from(notificationPublications)
        .where(eq(notificationPublications.watchId, f.watch.id)),
    ).toHaveLength(0);
    const [evaluation] = await db
      .select()
      .from(recommendationEvaluations)
      .where(eq(recommendationEvaluations.watchId, f.watch.id));
    expect(evaluation.versions.build).toBe('canopy-weighted-radiation-v3');
    expect(evaluation.winner?.plan?.schemaVersion).toBe(3);
  });

  it('uses the refreshed clock to prevent publication and sending after slow forecast preparation', async () => {
    const f = await fixture();
    let current = now;
    vi.mocked(OpenMeteoRouteForecastPreparer.prototype.prepare).mockImplementation(async () => {
      current = new Date('2026-09-19T07:00:00.000Z');
      return preparedRouteForecastFromForecast(forecast(), 'UTC');
    });
    const result = await runScheduler(now, () => current);
    expect(result).toMatchObject({ acquired: true, evaluated: 1, evaluationFailures: 0 });
    expect(expo.send).not.toHaveBeenCalled();
    expect(
      await db
        .select()
        .from(notificationPublications)
        .where(eq(notificationPublications.watchId, f.watch.id)),
    ).toHaveLength(0);
    const [evaluation] = await db
      .select()
      .from(recommendationEvaluations)
      .where(eq(recommendationEvaluations.watchId, f.watch.id));
    expect(evaluation.decisionTime).toEqual(current);
  });

  it('records when a receipt was observed after a slow response', async () => {
    const f = await fixture();
    const [delivery] = await db
      .insert(notificationDeliveries)
      .values({
        watchId: f.watch.id,
        deviceId: f.device.id,
        occurrenceDate: '2026-09-18',
        ticketState: 'ok',
        ticketId: 'delayed-receipt',
        sentAt: new Date(now.getTime() - 10 * 60_000),
        attempts: 1,
      })
      .returning();
    let current = now;
    expo.receipts.mockImplementation(async () => {
      current = new Date(now.getTime() + 20_000);
      return { 'delayed-receipt': { status: 'error', message: 'Delivery rejected' } };
    });
    const result = await runScheduler(now, () => current);
    expect(result.receiptFailures).toBe(1);
    const [stored] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, delivery.id));
    expect(stored.receiptReceivedAt).toEqual(current);
    expect(stored.receiptState).toBe('error');
  });

  it('drains background canopy work through finally after evaluation persistence fails', async () => {
    Object.assign(config, { canopyModelMode: 'active' });
    await fixture();
    let finish!: (profile: CanopyEvidenceProfile) => void;
    let pendingProfile!: CanopyEvidenceProfile;
    vi.mocked(UsdaRouteCanopyPreparer.prototype.prepare).mockImplementation((route) => {
      pendingProfile = unknownCanopyForRoute(route);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    vi.spyOn(evaluations, 'appendRecommendationEvaluation').mockRejectedValue(
      new Error('evaluation persistence failed'),
    );
    const forecastClose = vi.spyOn(ForecastPreparationCoordinator.prototype, 'close');
    const canopyClose = vi.spyOn(CanopyPreparationCoordinator.prototype, 'close');
    let settled = false;
    const running = runScheduler(now, () => now).finally(() => {
      settled = true;
    });
    try {
      await vi.waitFor(() => {
        expect(UsdaRouteCanopyPreparer.prototype.prepare).toHaveBeenCalledOnce();
        expect(forecastClose).toHaveBeenCalledOnce();
        expect(canopyClose).toHaveBeenCalledOnce();
      });
      expect(settled).toBe(false);
    } finally {
      finish?.(pendingProfile);
    }
    await expect(running).resolves.toMatchObject({
      acquired: true,
      evaluated: 0,
      evaluationFailures: 1,
      phaseFailures: [],
    });
    expect(expo.send).not.toHaveBeenCalled();
  });
});
