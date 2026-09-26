import { notificationPayloadSchema } from '@runcast/contracts';
import { and, asc, eq, lt, or } from 'drizzle-orm';
import { db } from '../db/client';
import {
  deviceInstallations,
  notificationDeliveries,
  notificationPublications,
  watches,
} from '../db/schema';
import { logOperationalEvent } from '../observability';
import {
  pendingDeliveryCondition,
  MAX_PUSH_DELIVERY_ATTEMPTS,
  RETRYABLE_PUSH_TICKET_STATE,
  attemptPushDelivery,
} from './delivery';

export interface PublicationDeliveryDrainResult {
  attempted: number;
  accepted: number;
  expired: number;
  failed: number;
  cancelled: number;
  errors: number;
}

/**
 * Drain durable intents under the scheduler's cross-process lock. Each intent is
 * visited once per pass. Expo has no idempotency key: a crash after acceptance but
 * before ticket persistence can result in a duplicate push on the next pass.
 */
export async function drainPublicationDeliveries(
  clock: () => Date = () => new Date(),
  publicationId?: string,
): Promise<PublicationDeliveryDrainResult> {
  const result: PublicationDeliveryDrainResult = {
    attempted: 0,
    accepted: 0,
    expired: 0,
    failed: 0,
    cancelled: 0,
    errors: 0,
  };
  const outstanding = await db
    .select({
      delivery: notificationDeliveries,
      device: deviceInstallations,
      publication: notificationPublications,
    })
    .from(notificationDeliveries)
    .innerJoin(deviceInstallations, eq(deviceInstallations.id, notificationDeliveries.deviceId))
    .innerJoin(watches, eq(watches.id, notificationDeliveries.watchId))
    .innerJoin(
      notificationPublications,
      eq(notificationPublications.id, notificationDeliveries.publicationId),
    )
    .where(
      and(
        or(
          eq(notificationDeliveries.ticketState, 'pending'),
          eq(notificationDeliveries.ticketState, RETRYABLE_PUSH_TICKET_STATE),
        ),
        lt(notificationDeliveries.attempts, MAX_PUSH_DELIVERY_ATTEMPTS),
        publicationId ? eq(notificationPublications.id, publicationId) : undefined,
      ),
    )
    .orderBy(asc(notificationDeliveries.createdAt), asc(notificationDeliveries.id))
    .limit(500);
  for (const item of outstanding) {
    try {
      const payload = notificationPayloadSchema.safeParse(item.delivery.payload);
      if (!payload.success) {
        await db
          .update(notificationDeliveries)
          .set({
            ticketState: 'error',
            lastError: 'Stored push payload is invalid',
            updatedAt: clock(),
          })
          .where(and(eq(notificationDeliveries.id, item.delivery.id), pendingDeliveryCondition()));
        logOperationalEvent('error', 'push.retry-payload-invalid', {
          deliveryId: item.delivery.id,
          publicationId: item.publication.id,
        });
        result.failed += 1;
        continue;
      }
      const outcome = await attemptPushDelivery({
        delivery: item.delivery,
        device: item.device,
        title: item.publication.title,
        body: item.publication.body,
        payload: payload.data,
        now: clock(),
        clock,
        onAttempt: () => {
          result.attempted += 1;
        },
        logContext: {
          watchId: item.delivery.watchId,
          publicationId: item.publication.id,
          retry: item.delivery.attempts > 0,
        },
      });
      if (outcome === 'cancelled') result.cancelled += 1;
      if (outcome === 'accepted') result.accepted += 1;
      if (outcome === 'failed') result.failed += 1;
      if (outcome === 'window-closed') result.expired += 1;
    } catch (error) {
      result.errors += 1;
      logOperationalEvent('error', 'push.delivery-processing-failed', {
        deliveryId: item.delivery.id,
        publicationId: item.publication.id,
        error,
      });
    }
  }
  return result;
}
