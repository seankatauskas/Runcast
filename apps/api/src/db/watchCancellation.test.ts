import { randomUUID } from 'node:crypto';
import {
  PLANNING_ALGORITHM_VERSION_MANIFEST,
  parseGpx,
  unknownLegacyCoverageMask,
} from '@runcast/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { ExpoPushProviderError } from '../providers/expo';
import { closeDatabase, db, sql } from './client';
import { buildApp } from '../app';
import { createSession } from '../session';
import type { FastifyInstance } from 'fastify';
import {
  deviceInstallations,
  notificationDeliveries,
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

integration('watch delivery cancellation', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  beforeEach(() => {
    expo.send.mockReset().mockResolvedValue({ status: 'ok', id: 'fake-ticket' });
  });
  afterEach(async () => {
    if (ownerIds.length) await db.delete(users).where(inArray(users.id, ownerIds.splice(0)));
  });
  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  async function setEnabled(f: Awaited<ReturnType<typeof fixture>>, enabled: boolean, version = 1) {
    const session = await createSession(f.owner.id, randomUUID());
    return app.inject({
      method: 'PATCH',
      url: `/v1/watches/${f.watch.id}`,
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { enabled, version, idempotencyKey: randomUUID() },
    });
  }

  it('cancels pending and retryable intents atomically while retaining accepted deliveries after reenable', async () => {
    const f = await fixture(3);
    const publication = await appendNotificationPublication(f.publicationInput);
    const intents = await deliveries(publication.id);
    await db
      .update(notificationDeliveries)
      .set({ ticketState: 'retryable-error', attempts: 1 })
      .where(eq(notificationDeliveries.id, intents[1]!.id));
    await db
      .update(notificationDeliveries)
      .set({ ticketState: 'ok', attempts: 1, sentAt: now })
      .where(eq(notificationDeliveries.id, intents[2]!.id));
    expect((await setEnabled(f, false)).statusCode).toBe(200);
    expect((await deliveries(publication.id)).map((d) => d.ticketState).sort()).toEqual([
      'cancelled',
      'cancelled',
      'ok',
    ]);
    expect((await setEnabled(f, true, 2)).statusCode).toBe(200);
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      attempted: 0,
      failed: 0,
    });
    expect(expo.send).not.toHaveBeenCalled();
    expect((await deliveries(publication.id)).find((d) => d.ticketState === 'ok')?.sentAt).toEqual(
      now,
    );
  });

  it('rolls back disabling when cancellation cannot commit', async () => {
    const f = await fixture();
    const publication = await appendNotificationPublication(f.publicationInput);
    await sql`CREATE OR REPLACE FUNCTION test_watch_cancel_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW.ticket_state = 'cancelled' THEN RAISE EXCEPTION 'injected cancellation failure'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`;
    await sql.unsafe(`CREATE TRIGGER test_watch_cancel_failure BEFORE UPDATE ON notification_deliveries
      FOR EACH ROW WHEN (NEW.watch_id = '${f.watch.id}'::uuid) EXECUTE FUNCTION test_watch_cancel_failure()`);
    try {
      expect((await setEnabled(f, false)).statusCode).toBe(500);
      expect(await db.query.watches.findFirst({ where: eq(watches.id, f.watch.id) })).toMatchObject(
        { enabled: true, version: 1 },
      );
      expect(await deliveries(publication.id)).toMatchObject([{ ticketState: 'pending' }]);
    } finally {
      await sql`DROP TRIGGER IF EXISTS test_watch_cancel_failure ON notification_deliveries`;
      await sql`DROP FUNCTION IF EXISTS test_watch_cancel_failure()`;
    }
  });

  it.each(['throw', 'ticket'])(
    'rechecks a batched intent after disable and never resurrects a failed in-flight send (%s)',
    async (failure) => {
      const f = await fixture(2);
      const publication = await appendNotificationPublication(f.publicationInput);
      expo.send.mockImplementationOnce(async () => {
        expect((await setEnabled(f, false)).statusCode).toBe(200);
        if (failure === 'throw')
          throw new ExpoPushProviderError('temporary provider failure', true);
        return { status: 'error', details: { error: 'MessageRateExceeded' } };
      });
      expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
        attempted: 1,
        cancelled: 2,
      });
      expect(expo.send).toHaveBeenCalledTimes(1);
      expect((await deliveries(publication.id)).every((d) => d.ticketState === 'cancelled')).toBe(
        true,
      );
      expect((await setEnabled(f, true, 2)).statusCode).toBe(200);
      await drainPublicationDeliveries(() => now, publication.id);
      expect(expo.send).toHaveBeenCalledTimes(1);
    },
  );

  it('records acceptance of an already in-flight push while cancelling the rest of its batch', async () => {
    const f = await fixture(2);
    const publication = await appendNotificationPublication(f.publicationInput);
    expo.send.mockImplementationOnce(async () => {
      expect((await setEnabled(f, false)).statusCode).toBe(200);
      return { status: 'ok', id: 'accepted-in-flight' };
    });
    expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
      attempted: 1,
      accepted: 1,
      cancelled: 1,
    });
    expect((await deliveries(publication.id)).map((d) => d.ticketState).sort()).toEqual([
      'cancelled',
      'ok',
    ]);
  });

  it.each(['watch', 'device'])(
    'refreshes %s eligibility for later rows in an already loaded batch',
    async (disabled) => {
      const f = await fixture(2);
      const publication = await appendNotificationPublication(f.publicationInput);
      expo.send.mockImplementationOnce(async () => {
        if (disabled === 'watch') {
          await db.update(watches).set({ enabled: false }).where(eq(watches.id, f.watch.id));
        } else {
          await db
            .update(deviceInstallations)
            .set({ enabled: false })
            .where(eq(deviceInstallations.userId, f.owner.id));
        }
        return { status: 'ok', id: 'first-accepted' };
      });
      expect(await drainPublicationDeliveries(() => now, publication.id)).toMatchObject({
        attempted: 1,
        accepted: 1,
        cancelled: 1,
      });
      expect(expo.send).toHaveBeenCalledTimes(1);
      expect((await deliveries(publication.id)).map((d) => d.ticketState).sort()).toEqual([
        'cancelled',
        'ok',
      ]);
    },
  );

  it('does not enqueue fresh intents for a publication after its watch was disabled', async () => {
    const f = await fixture();
    expect((await setEnabled(f, false)).statusCode).toBe(200);
    const publication = await appendNotificationPublication(f.publicationInput);
    expect(await deliveries(publication.id)).toEqual([]);
    expect((await setEnabled(f, true, 2)).statusCode).toBe(200);
    await appendNotificationPublication(f.publicationInput);
    expect(await deliveries(publication.id)).toEqual([]);
  });
});
