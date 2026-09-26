import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { deviceInstallations, notificationDeliveries } from '../db/schema';
import { logOperationalEvent } from '../observability';
import { fetchExpoReceipts } from '../providers/expo';

// Expo clears receipts after 24h. Missing receipts describe unknown delivery,
// never proof of failure or a reason to resend an accepted notification.
export const RECEIPT_LIFETIME_MS = 24 * 60 * 60_000;
const INITIAL_CHECK_MS = 5 * 60_000;
const BATCH_SIZE = 500;

export function receiptRetryDelayMs(attempts: number): number {
  return Math.min(60, 15 * 2 ** Math.min(Math.max(attempts - 1, 0), 2)) * 60_000;
}

/** Runs under the scheduler lock. Claim retry times before I/O so outages stay fair. */
export async function reconcileReceipts(clock: () => Date) {
  const now = clock();
  const unresolved = and(
    eq(notificationDeliveries.ticketState, 'ok'),
    isNull(notificationDeliveries.receiptState),
  );
  const expired = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        unresolved,
        or(
          lte(notificationDeliveries.sentAt, new Date(now.getTime() - RECEIPT_LIFETIME_MS)),
          isNull(notificationDeliveries.sentAt),
          isNull(notificationDeliveries.ticketId),
        ),
      ),
    )
    .orderBy(asc(notificationDeliveries.sentAt), asc(notificationDeliveries.id))
    .limit(BATCH_SIZE);
  if (expired.length) {
    await db
      .update(notificationDeliveries)
      .set({
        receiptState: 'unavailable',
        receiptNextCheckAt: null,
        lastError: 'Push receipt unavailable within the provider retention window',
        updatedAt: now,
      })
      .where(
        inArray(
          notificationDeliveries.id,
          expired.map((d) => d.id),
        ),
      );
  }
  const dueAt = sql<Date>`coalesce(${notificationDeliveries.receiptNextCheckAt}, ${notificationDeliveries.sentAt})`;
  const outstanding = await db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        unresolved,
        isNotNull(notificationDeliveries.ticketId),
        gt(notificationDeliveries.sentAt, new Date(now.getTime() - RECEIPT_LIFETIME_MS)),
        lte(notificationDeliveries.sentAt, new Date(now.getTime() - INITIAL_CHECK_MS)),
        lte(dueAt, now.toISOString()),
      ),
    )
    .orderBy(asc(dueAt), asc(notificationDeliveries.id))
    .limit(BATCH_SIZE);
  if (!outstanding.length) return { failures: 0, unavailable: expired.length };
  await db.transaction(async (tx) => {
    for (const delivery of outstanding) {
      await tx
        .update(notificationDeliveries)
        .set({
          receiptAttempts: delivery.receiptAttempts + 1,
          receiptNextCheckAt: new Date(
            Math.min(
              now.getTime() + receiptRetryDelayMs(delivery.receiptAttempts + 1),
              delivery.sentAt!.getTime() + RECEIPT_LIFETIME_MS,
            ),
          ),
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id));
    }
  });
  const ids = outstanding.flatMap((d) => (d.ticketId ? [d.ticketId] : []));
  let receipts: Awaited<ReturnType<typeof fetchExpoReceipts>>;
  try {
    receipts = await fetchExpoReceipts(ids);
  } catch (error) {
    logOperationalEvent('error', 'push.receipt-fetch-failed', { deliveryCount: ids.length, error });
    throw error;
  }
  let failures = 0;
  for (const delivery of outstanding) {
    const receipt = delivery.ticketId ? receipts[delivery.ticketId] : undefined;
    if (!receipt || !['ok', 'error'].includes(receipt.status)) continue;
    const receivedAt = clock();
    await db.transaction(async (tx) => {
      await tx
        .update(notificationDeliveries)
        .set({
          receiptState: receipt.status,
          receiptReceivedAt: receivedAt,
          receiptNextCheckAt: null,
          lastError:
            receipt.status === 'error' ? (receipt.message ?? 'Expo delivery failed') : null,
          updatedAt: receivedAt,
        })
        .where(eq(notificationDeliveries.id, delivery.id));
      if (receipt.details?.error === 'DeviceNotRegistered') {
        await tx
          .update(deviceInstallations)
          .set({ enabled: false })
          .where(eq(deviceInstallations.id, delivery.deviceId));
      }
    });
    if (receipt.status === 'error') {
      failures++;
      logOperationalEvent('error', 'push.receipt-error', {
        deliveryId: delivery.id,
        watchId: delivery.watchId,
        errorCode: receipt.details?.error ?? 'EXPO_DELIVERY_FAILED',
      });
    }
  }
  return { failures, unavailable: expired.length };
}
