import { randomUUID } from 'node:crypto';
import {
  PLANNING_ALGORITHM_VERSION_MANIFEST,
  parseGpx,
  unknownLegacyCoverageMask,
} from '@runcast/core';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpoTicket } from '../providers/expo';

const expo = vi.hoisted(() => ({ send: vi.fn<(...args: unknown[]) => Promise<ExpoTicket>>() }));
vi.mock('../providers/expo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../providers/expo')>()),
  sendExpoPush: expo.send,
}));

import {
  appendNotificationPublication,
  type AppendPublicationInput,
} from '../planning/evaluations';
import { drainPublicationDeliveries } from '../notifications/outbox';
import { PUSH_DELIVERY_WINDOW_CLOSED } from '../notifications/delivery';
import { ExpoPushProviderError } from '../providers/expo';
import { closeDatabase, db } from './client';
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
const now = new Date('2026-09-19T10:00:00Z');
const deadline = new Date(now.getTime() + 60_000);

async function fixture(deviceCount = 1) {
  const [owner] = await db.insert(users).values({}).returning();
  ownerIds.push(owner.id);
  const routeId = randomUUID();
  const canonicalRoute = parseGpx(
    '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
    routeId,
    'Outbox trail',
  );
  await db.insert(routes).values({
    id: routeId,
    ownerId: owner.id,
    source: 'gpx',
    canonicalRoute,
    name: canonicalRoute.name,
    distance: canonicalRoute.totalDistance,
    coverageMask: unknownLegacyCoverageMask(canonicalRoute),
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
  const evaluationValues = {
    routeId,
    watchId: watch.id,
    occurrenceDate: '2026-09-19',
    status: 'no-suitable-window' as const,
    winner: null,
    candidateAssessments: [],
    decisionTime: now,
    windowStart: deadline,
    windowEnd: new Date(deadline.getTime() + 60_000),
    minimumNoticeMs: 0,
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
  };
  const [evaluation] = await db
    .insert(recommendationEvaluations)
    .values({ ...evaluationValues, inputHash: randomUUID() })
    .returning();
  const devices = await db
    .insert(deviceInstallations)
    .values(
      Array.from({ length: deviceCount + 1 }, (_, i) => ({
        userId: owner.id,
        deviceId: `device-${i}`,
        expoPushToken: `ExponentPushToken[${randomUUID()}]`,
        platform: 'ios',
        appVersion: 'test',
        enabled: i < deviceCount,
      })),
    )
    .returning();
  const publicationInput: AppendPublicationInput = {
    evaluationId: evaluation.id,
    watchId: watch.id,
    occurrenceDate: '2026-09-19',
    revision: 1,
    status: 'no-suitable-window',
    title: 'No suitable start window',
    body: 'Outbox trail forecast',
    deepLink: `runcast://watch-results/${evaluation.id}?watch=${watch.id}`,
    data: {},
  };
  return { owner, watch, evaluation, evaluationValues, publicationInput, devices };
}

async function deliveries(publicationId: string) {
  return db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.publicationId, publicationId));
}

integration('durable publication outbox', () => {
  beforeEach(() => {
    expo.send.mockReset().mockResolvedValue({ status: 'ok', id: 'fake-expo-ticket' });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (ownerIds.length) await db.delete(users).where(inArray(users.id, ownerIds.splice(0)));
  });
  afterAll(closeDatabase);

  it('recovers committed intents after a crash before sending, with immutable payloads and no disabled devices', async () => {
    const f = await fixture(2);
    const publication = await appendNotificationPublication(f.publicationInput);
    const intents = await deliveries(publication.id);
    expect(intents).toHaveLength(2);
    expect(
      intents.every((intent) => intent.ticketState === 'pending' && intent.attempts === 0),
    ).toBe(true);
    expect(expo.send).not.toHaveBeenCalled();
    await db
      .update(routes)
      .set({ name: 'Renamed after publication' })
      .where(eq(routes.id, f.evaluation.routeId));
    const outcome = await drainPublicationDeliveries(() => now, publication.id);
    expect(outcome).toMatchObject({ accepted: 2, errors: 0 });
    expect(expo.send).toHaveBeenCalledTimes(2);
    expect(expo.send.mock.calls[0]?.[0]).toMatchObject({
      data: { route: { name: 'Outbox trail' } },
    });
    expect((await deliveries(publication.id)).every((intent) => intent.ticketState === 'ok')).toBe(
      true,
    );
    await drainPublicationDeliveries(() => now, publication.id);
    expect(expo.send).toHaveBeenCalledTimes(2);
  });

  it('rolls back the publication if delivery payload creation fails after publication insertion', async () => {
    const f = await fixture();
    await expect(
      appendNotificationPublication({ ...f.publicationInput, deepLink: 'invalid-url' }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(notificationPublications)
        .where(eq(notificationPublications.evaluationId, f.evaluation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.watchId, f.watch.id)),
    ).toHaveLength(0);
    const retried = await appendNotificationPublication(f.publicationInput);
    expect(await deliveries(retried.id)).toHaveLength(1);
  });

  it('resolves simultaneous same-evaluation and same-occurrence revision publishers to one complete intent set', async () => {
    const f = await fixture(2);
    const [otherEvaluation] = await db
      .insert(recommendationEvaluations)
      .values({ ...f.evaluationValues, inputHash: randomUUID() })
      .returning();
    const published = await Promise.all([
      appendNotificationPublication(f.publicationInput),
      appendNotificationPublication(f.publicationInput),
      appendNotificationPublication({
        ...f.publicationInput,
        evaluationId: otherEvaluation.id,
        title: 'Competing evaluation',
      }),
    ]);
    expect(new Set(published.map((item) => item.id)).size).toBe(1);
    expect(await deliveries(published[0]!.id)).toHaveLength(2);
    expect(
      await db
        .select()
        .from(notificationPublications)
        .where(
          and(
            eq(notificationPublications.watchId, f.watch.id),
            eq(notificationPublications.revision, 1),
          ),
        ),
    ).toHaveLength(1);
  });

  it('rechecks the deadline between devices after a slow provider call', async () => {
    const f = await fixture(2);
    const publication = await appendNotificationPublication(f.publicationInput);
    let clock = now;
    expo.send.mockImplementationOnce(async () => {
      clock = deadline;
      return { status: 'ok', id: 'fake-expo-ticket' };
    });
    expect(await drainPublicationDeliveries(() => clock, publication.id)).toMatchObject({
      accepted: 1,
      expired: 1,
    });
    expect(expo.send).toHaveBeenCalledTimes(1);
    const intents = await deliveries(publication.id);
    expect(intents.find((intent) => intent.ticketState === 'error')).toMatchObject({
      attempts: 0,
      lastError: PUSH_DELIVERY_WINDOW_CLOSED,
    });
    expect(intents.find((intent) => intent.ticketState === 'ok')?.sentAt).toEqual(deadline);
  });

  it('keeps ambiguous acceptance retryable when persisting the ticket fails and continues other deliveries', async () => {
    const f = await fixture(2);
    const publication = await appendNotificationPublication(f.publicationInput);
    vi.spyOn(db, 'update').mockImplementationOnce(() => {
      throw new Error('simulated disconnect after Expo accepted');
    });
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      accepted: 1,
      errors: 1,
    });
    const intents = await deliveries(publication.id);
    expect(intents.find((intent) => intent.ticketState === 'pending')).toMatchObject({
      attempts: 0,
      lastError: null,
    });
    expect(expo.send).toHaveBeenCalledTimes(2);
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      accepted: 1,
      errors: 0,
    });
    expect(expo.send).toHaveBeenCalledTimes(3);
  });

  it('terminalizes queued intents when a device is disabled, without sending or retaining a stale backlog', async () => {
    const f = await fixture();
    const publication = await appendNotificationPublication(f.publicationInput);
    await db
      .update(deviceInstallations)
      .set({ enabled: false })
      .where(eq(deviceInstallations.id, f.devices[0]!.id));
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      attempted: 0,
      cancelled: 1,
      errors: 0,
    });
    expect(expo.send).not.toHaveBeenCalled();
    expect(await deliveries(publication.id)).toMatchObject([
      {
        ticketState: 'cancelled',
        attempts: 0,
        lastError: 'Device disabled before notification delivery',
      },
    ]);
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      attempted: 0,
      failed: 0,
    });
  });

  it('retries transient provider failures on the next drain without creating more intents', async () => {
    const f = await fixture();
    const publication = await appendNotificationPublication(f.publicationInput);
    expo.send.mockRejectedValueOnce(new ExpoPushProviderError('temporary outage', true));
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      failed: 1,
      errors: 0,
    });
    expect(await deliveries(publication.id)).toMatchObject([
      { ticketState: 'retryable-error', attempts: 1 },
    ]);
    await appendNotificationPublication(f.publicationInput);
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      accepted: 1,
    });
    expect(await deliveries(publication.id)).toMatchObject([{ ticketState: 'ok', attempts: 2 }]);
  });
});
