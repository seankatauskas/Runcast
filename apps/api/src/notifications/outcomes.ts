import { inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { notificationDeliveries } from '../db/schema';
import { PUSH_DELIVERY_WINDOW_CLOSED } from './delivery';

type DeliveryOutcome = Pick<
  typeof notificationDeliveries.$inferSelect,
  'ticketState' | 'sentAt' | 'receiptState' | 'receiptReceivedAt' | 'lastError'
>;

export function summarizeDeliveryOutcomes(deliveries: DeliveryOutcome[]) {
  const earliest = (dates: (Date | null)[]) => {
    const times = dates.flatMap((date) => (date ? [date.getTime()] : []));
    return times.length ? new Date(Math.min(...times)).toISOString() : null;
  };
  return {
    providerAcceptedAt: earliest(
      deliveries.filter((d) => d.ticketState === 'ok').map((d) => d.sentAt),
    ),
    receiptReceivedAt: earliest(deliveries.map((d) => d.receiptReceivedAt)),
    acceptedCount: deliveries.filter((d) => d.ticketState === 'ok').length,
    receiptSuccessCount: deliveries.filter((d) => d.receiptState === 'ok').length,
    receiptFailureCount: deliveries.filter((d) => d.receiptState === 'error').length,
    receiptUnavailableCount: deliveries.filter((d) => d.receiptState === 'unavailable').length,
    cancelledCount: deliveries.filter((d) => d.ticketState === 'cancelled').length,
    pendingCount: deliveries.filter((d) => ['pending', 'retryable-error'].includes(d.ticketState))
      .length,
    expiredCount: deliveries.filter((d) => d.lastError === PUSH_DELIVERY_WINDOW_CLOSED).length,
    failedCount: deliveries.filter(
      (d) => d.ticketState === 'error' && d.lastError !== PUSH_DELIVERY_WINDOW_CLOSED,
    ).length,
  };
}

export type DeliveryOutcomes = ReturnType<typeof summarizeDeliveryOutcomes>;

export async function publicationDeliveryOutcomes(
  publicationIds: string[],
): Promise<Map<string, DeliveryOutcomes>> {
  if (!publicationIds.length) return new Map();
  const rows = await db
    .select({
      publicationId: notificationDeliveries.publicationId,
      ticketState: notificationDeliveries.ticketState,
      sentAt: notificationDeliveries.sentAt,
      receiptState: notificationDeliveries.receiptState,
      receiptReceivedAt: notificationDeliveries.receiptReceivedAt,
      lastError: notificationDeliveries.lastError,
    })
    .from(notificationDeliveries)
    .where(inArray(notificationDeliveries.publicationId, publicationIds));
  const grouped = new Map<string, DeliveryOutcome[]>();
  for (const row of rows) {
    if (!row.publicationId) continue;
    const group = grouped.get(row.publicationId) ?? [];
    group.push(row);
    grouped.set(row.publicationId, group);
  }
  return new Map(
    publicationIds.map((id) => [id, summarizeDeliveryOutcomes(grouped.get(id) ?? [])]),
  );
}

export async function notificationBacklogMetrics(now: Date) {
  const pending = sql`${notificationDeliveries.ticketState} IN ('pending', 'retryable-error')`;
  const [row] = await db
    .select({
      pendingDeliveries: sql<number>`count(*) filter (where ${pending})`.mapWith(Number),
      oldestPendingAt: sql<
        string | null
      >`min(${notificationDeliveries.createdAt}) filter (where ${pending})`,
      expiredDeliveries:
        sql<number>`count(*) filter (where ${notificationDeliveries.lastError} = ${PUSH_DELIVERY_WINDOW_CLOSED})`.mapWith(
          Number,
        ),
      acceptedDeliveries:
        sql<number>`count(*) filter (where ${notificationDeliveries.ticketState} = 'ok')`.mapWith(
          Number,
        ),
      cancelledDeliveries:
        sql<number>`count(*) filter (where ${notificationDeliveries.ticketState} = 'cancelled')`.mapWith(
          Number,
        ),
      receiptUnavailable:
        sql<number>`count(*) filter (where ${notificationDeliveries.receiptState} = 'unavailable')`.mapWith(
          Number,
        ),
      pendingReceipts:
        sql<number>`count(*) filter (where ${notificationDeliveries.ticketState} = 'ok' AND ${notificationDeliveries.receiptState} IS NULL)`.mapWith(
          Number,
        ),
      receiptSuccesses:
        sql<number>`count(*) filter (where ${notificationDeliveries.receiptState} = 'ok')`.mapWith(
          Number,
        ),
      receiptFailures:
        sql<number>`count(*) filter (where ${notificationDeliveries.receiptState} = 'error')`.mapWith(
          Number,
        ),
    })
    .from(notificationDeliveries);
  const { oldestPendingAt, ...counts } = row;
  return {
    ...counts,
    oldestPendingAgeMs: oldestPendingAt
      ? Math.max(0, now.getTime() - new Date(oldestPendingAt).getTime())
      : 0,
  };
}
