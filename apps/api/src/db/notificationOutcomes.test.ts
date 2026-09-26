import { randomUUID } from 'node:crypto';
import {
  PLANNING_ALGORITHM_VERSION_MANIFEST,
  parseGpx,
  unknownLegacyCoverageMask,
} from '@runcast/core';
import { watchNotificationStatusSchema, watchResultDetailSchema } from '@runcast/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { appendNotificationPublication } from '../planning/evaluations';
import { createSession } from '../session';
import { notificationBacklogMetrics } from '../notifications/outcomes';
import { PUSH_DELIVERY_WINDOW_CLOSED } from '../notifications/delivery';
import { db, closeDatabase } from './client';
import {
  users,
  routes,
  watches,
  deviceInstallations,
  recommendationEvaluations,
  notificationDeliveries,
} from './schema';

const integration = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;
const owners: string[] = [];

integration('notification outcome reporting', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    if (owners.length) await db.delete(users).where(inArray(users.id, owners.splice(0)));
  });
  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  async function fixture() {
    const [owner] = await db.insert(users).values({}).returning();
    owners.push(owner.id);
    const session = await createSession(owner.id, randomUUID());
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Outcome route',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: owner.id,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: randomUUID(),
    });
    const [watch] = await db
      .insert(watches)
      .values({
        userId: owner.id,
        routeId,
        weekdays: 127,
        timezone: 'UTC',
        startMinutes: 600,
        endMinutes: 660,
        speed: 3,
        leadMinutes: 60,
      })
      .returning();
    const [evaluation] = await db
      .insert(recommendationEvaluations)
      .values({
        routeId,
        watchId: watch.id,
        occurrenceDate: '2026-09-19',
        status: 'no-suitable-window',
        winner: null,
        candidateAssessments: [],
        decisionTime: new Date(),
        windowStart: new Date(Date.now() + 60_000),
        windowEnd: new Date(Date.now() + 3_600_000),
        minimumNoticeMs: 0,
        versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
        inputHash: randomUUID(),
      })
      .returning();
    await db.insert(deviceInstallations).values({
      userId: owner.id,
      deviceId: randomUUID(),
      expoPushToken: `ExponentPushToken[${randomUUID()}]`,
      platform: 'ios',
      appVersion: 'test',
    });
    return {
      headers,
      watch,
      evaluation,
      resultUrl: `/v1/watches/${watch.id}/results/${evaluation.id}`,
    };
  }

  async function publish(f: Awaited<ReturnType<typeof fixture>>) {
    return appendNotificationPublication({
      evaluationId: f.evaluation.id,
      watchId: f.watch.id,
      occurrenceDate: '2026-09-19',
      revision: 1,
      status: 'no-suitable-window',
      title: 'Forecast ready',
      body: 'View result',
      deepLink: `runcast://watch-results/${f.evaluation.id}?watch=${f.watch.id}`,
      data: {},
    });
  }

  it('separates publication, provider acceptance and receipt without changing strict result shape', async () => {
    const f = await fixture();
    let status = await app.inject({ url: `${f.resultUrl}/notification`, headers: f.headers });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      publicationId: null,
      publishedAt: null,
      providerAcceptedAt: null,
      receiptReceivedAt: null,
      pendingCount: 0,
    });
    const publication = await publish(f);
    const result = () => app.inject({ url: f.resultUrl, headers: f.headers });
    expect((await result()).json().notifiedAt).toBeNull();
    status = await app.inject({ url: `${f.resultUrl}/notification`, headers: f.headers });
    expect(watchNotificationStatusSchema.parse(status.json())).toMatchObject({
      publicationId: publication.id,
      publishedAt: publication.createdAt.toISOString(),
      providerAcceptedAt: null,
      pendingCount: 1,
    });
    const acceptedAt = new Date('2026-09-19T10:00:00Z');
    await db
      .update(notificationDeliveries)
      .set({ ticketState: 'ok', ticketId: 'fixture-ticket', sentAt: acceptedAt, attempts: 1 })
      .where(eq(notificationDeliveries.publicationId, publication.id));
    expect(watchResultDetailSchema.parse((await result()).json()).notifiedAt).toBe(
      acceptedAt.toISOString(),
    );
    const receivedAt = new Date(acceptedAt.getTime() + 60_000);
    await db
      .update(notificationDeliveries)
      .set({
        receiptState: 'error',
        receiptReceivedAt: receivedAt,
        lastError: 'Provider delivery failed',
      })
      .where(eq(notificationDeliveries.publicationId, publication.id));
    status = await app.inject({ url: `${f.resultUrl}/notification`, headers: f.headers });
    expect(status.json()).toMatchObject({
      providerAcceptedAt: acceptedAt.toISOString(),
      receiptReceivedAt: receivedAt.toISOString(),
      acceptedCount: 1,
      receiptFailureCount: 1,
      receiptSuccessCount: 0,
      pendingCount: 0,
    });
    const history = await app.inject({
      url: `/v1/watches/${f.watch.id}/results`,
      headers: f.headers,
    });
    expect(history.json().results[0].notifiedAt).toBe(acceptedAt.toISOString());
  });

  it('enforces ownership on notification outcomes and hides device identifiers', async () => {
    const owner = await fixture();
    const stranger = await fixture();
    await publish(owner);
    expect(
      (await app.inject({ url: `${owner.resultUrl}/notification`, headers: stranger.headers }))
        .statusCode,
    ).toBe(404);
    expect((await app.inject({ url: `${owner.resultUrl}/notification` })).statusCode).toBe(401);
    const status = await app.inject({
      url: `${owner.resultUrl}/notification`,
      headers: owner.headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.body).not.toContain('expoPushToken');
    expect(status.body).not.toContain('deviceId');
  });

  it('reports pending age and expired deadlines separately from provider acceptance', async () => {
    const f = await fixture();
    const now = new Date();
    const before = await notificationBacklogMetrics(now);
    const publication = await publish(f);
    await db
      .update(notificationDeliveries)
      .set({ createdAt: new Date(now.getTime() - 45 * 60_000) })
      .where(eq(notificationDeliveries.publicationId, publication.id));
    const pending = await notificationBacklogMetrics(now);
    expect(pending.pendingDeliveries).toBe(before.pendingDeliveries + 1);
    expect(pending.oldestPendingAgeMs).toBeGreaterThanOrEqual(45 * 60_000);
    await db
      .update(notificationDeliveries)
      .set({ ticketState: 'error', lastError: PUSH_DELIVERY_WINDOW_CLOSED })
      .where(eq(notificationDeliveries.publicationId, publication.id));
    const after = await notificationBacklogMetrics(now);
    expect(after.pendingDeliveries).toBe(before.pendingDeliveries);
    expect(after.expiredDeliveries).toBe(before.expiredDeliveries + 1);
    expect(after.acceptedDeliveries).toBe(before.acceptedDeliveries);
  });
});
