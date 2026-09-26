import { randomUUID } from 'node:crypto';
import { parseGpx, unknownLegacyCoverageMask } from '@runcast/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const expo = vi.hoisted(() => ({ receipts: vi.fn() }));
vi.mock('../providers/expo', () => ({ fetchExpoReceipts: expo.receipts }));
import { reconcileReceipts } from '../notifications/receipts';
import { closeDatabase, db } from './client';
import { users, routes, watches, deviceInstallations, notificationDeliveries } from './schema';
const integration = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;
const owners: string[] = [];
const now = new Date('2026-09-19T12:00:00Z');
async function fixture(count: number, ageMs = 20 * 60_000) {
  const [owner] = await db.insert(users).values({}).returning();
  owners.push(owner.id);
  const routeId = randomUUID();
  const route = parseGpx(
    '<gpx><trk><trkseg><trkpt lat="41" lon="-87"/><trkpt lat="41.01" lon="-87.01"/></trkseg></trk></gpx>',
    routeId,
    'Receipts',
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
  return db
    .insert(notificationDeliveries)
    .values(
      Array.from({ length: count }, () => ({
        watchId: watch.id,
        deviceId: device.id,
        occurrenceDate: '2026-09-19',
        ticketState: 'ok',
        ticketId: randomUUID(),
        attempts: 1,
        sentAt: new Date(now.getTime() - ageMs),
      })),
    )
    .returning();
}
integration('bounded fair receipt reconciliation', () => {
  beforeEach(() => expo.receipts.mockReset().mockResolvedValue({}));
  afterEach(async () => {
    if (owners.length) await db.delete(users).where(inArray(users.id, owners.splice(0)));
  });
  afterAll(closeDatabase);
  it('moves missing receipts behind newer work instead of starving the next batch', async () => {
    const rows = await fixture(501);
    await reconcileReceipts(() => now);
    expect(expo.receipts.mock.calls[0][0]).toHaveLength(500);
    await reconcileReceipts(() => now);
    expect(expo.receipts.mock.calls[1][0]).toHaveLength(1);
    expect(new Set(expo.receipts.mock.calls.flatMap((c) => c[0])).size).toBe(rows.length);
    await reconcileReceipts(() => now);
    expect(expo.receipts).toHaveBeenCalledTimes(2);
  });
  it('persists backoff before a provider outage and retries when due', async () => {
    const [row] = await fixture(1);
    expo.receipts.mockRejectedValueOnce(new Error('outage'));
    await expect(reconcileReceipts(() => now)).rejects.toThrow('outage');
    await reconcileReceipts(() => now);
    expect(expo.receipts).toHaveBeenCalledTimes(1);
    const [stored] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, row.id));
    expect(stored.receiptAttempts).toBe(1);
    expect(stored.receiptNextCheckAt).toEqual(new Date(now.getTime() + 15 * 60_000));
    await reconcileReceipts(() => new Date(now.getTime() + 15 * 60_000));
    expect(expo.receipts).toHaveBeenCalledTimes(2);
  });
  it('closes aged missing receipts as unavailable without claiming failure or receipt arrival', async () => {
    const [row] = await fixture(1, 24 * 60 * 60_000);
    expect(await reconcileReceipts(() => now)).toEqual({ failures: 0, unavailable: 1 });
    const [stored] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, row.id));
    expect(stored).toMatchObject({
      ticketState: 'ok',
      receiptState: 'unavailable',
      receiptReceivedAt: null,
      receiptNextCheckAt: null,
    });
    expect(expo.receipts).not.toHaveBeenCalled();
  });
  it('expires only a bounded batch without blocking newer receipt checks', async () => {
    await fixture(501, 25 * 60 * 60_000);
    const [fresh] = await fixture(1);
    expo.receipts.mockResolvedValue({ [fresh.ticketId!]: { status: 'ok' } });
    expect(await reconcileReceipts(() => now)).toEqual({ failures: 0, unavailable: 500 });
    expect(expo.receipts).toHaveBeenCalledWith([fresh.ticketId]);
    expect(await reconcileReceipts(() => now)).toEqual({ failures: 0, unavailable: 1 });
  });

  it('records receipt arrival after I/O and stops polling terminal receipts', async () => {
    const [row] = await fixture(1);
    let current = now;
    expo.receipts.mockImplementation(async () => {
      current = new Date(now.getTime() + 60_000);
      return { [row.ticketId!]: { status: 'error', details: { error: 'DeviceNotRegistered' } } };
    });
    expect(await reconcileReceipts(() => current)).toEqual({ failures: 1, unavailable: 0 });
    const [stored] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, row.id));
    expect(stored.receiptReceivedAt).toEqual(current);
    expect(stored.receiptNextCheckAt).toBeNull();
    const [device] = await db
      .select()
      .from(deviceInstallations)
      .where(eq(deviceInstallations.id, row.deviceId));
    expect(device.enabled).toBe(false);
    await reconcileReceipts(() => new Date(now.getTime() + 3_600_000));
    expect(expo.receipts).toHaveBeenCalledTimes(1);
  });
});
