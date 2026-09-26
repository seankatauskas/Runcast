import type { NotificationPayload } from '@runcast/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { deviceInstallations, notificationDeliveries, watches } from '../db/schema';
import { logOperationalEvent } from '../observability';
import { ExpoPushProviderError, expoTicketErrorIsRetryable, sendExpoPush } from '../providers/expo';

export const MAX_PUSH_DELIVERY_ATTEMPTS = 3;
export const RETRYABLE_PUSH_TICKET_STATE = 'retryable-error';
export const CANCELLED_PUSH_TICKET_STATE = 'cancelled';
export const PUSH_WATCH_DISABLED = 'Watch disabled before notification delivery';
export const PUSH_DEVICE_DISABLED = 'Device disabled before notification delivery';

export function pendingDeliveryCondition() {
  return inArray(notificationDeliveries.ticketState, ['pending', RETRYABLE_PUSH_TICKET_STATE]);
}

export const PUSH_DELIVERY_WINDOW_CLOSED = 'Push retry window closed before delivery succeeded';

type Delivery = typeof notificationDeliveries.$inferSelect;
type Device = typeof deviceInstallations.$inferSelect;

export type DeliveryAttemptDecision =
  | 'attempt'
  | 'cancelled'
  | 'already-delivered'
  | 'permanent-failure'
  | 'attempts-exhausted'
  | 'window-closed';

export function deliveryAttemptDecision(input: {
  ticketState: string;
  attempts: number;
  closesAt: number;
  now: number;
}): DeliveryAttemptDecision {
  if (input.ticketState === CANCELLED_PUSH_TICKET_STATE) return 'cancelled';
  if (input.ticketState === 'ok') return 'already-delivered';
  if (input.ticketState !== 'pending' && input.ticketState !== RETRYABLE_PUSH_TICKET_STATE) {
    return 'permanent-failure';
  }
  if (input.attempts >= MAX_PUSH_DELIVERY_ATTEMPTS) return 'attempts-exhausted';
  if (!Number.isFinite(input.closesAt) || input.now >= input.closesAt) return 'window-closed';
  return 'attempt';
}

function failureState(retryable: boolean, attempts: number): string {
  return retryable && attempts < MAX_PUSH_DELIVERY_ATTEMPTS ? RETRYABLE_PUSH_TICKET_STATE : 'error';
}

export async function closeExpiredDelivery(delivery: Delivery, now: Date): Promise<void> {
  if (delivery.ticketState !== 'pending' && delivery.ticketState !== RETRYABLE_PUSH_TICKET_STATE) {
    return;
  }
  await db
    .update(notificationDeliveries)
    .set({
      ticketState: 'error',
      lastError: PUSH_DELIVERY_WINDOW_CLOSED,
      updatedAt: now,
    })
    .where(and(eq(notificationDeliveries.id, delivery.id), pendingDeliveryCondition()));
}

export async function attemptPushDelivery(input: {
  delivery: Delivery;
  device: Device;
  title: string;
  body: string;
  payload: NotificationPayload;
  now: Date;
  clock?: () => Date;
  onAttempt?: () => void;
  logContext: Record<string, unknown>;
}): Promise<DeliveryAttemptDecision | 'accepted' | 'failed'> {
  // A batch snapshot may predate a watch edit or a previous delivery disabling a device.
  const [current] = await db
    .select({ delivery: notificationDeliveries, device: deviceInstallations, watch: watches })
    .from(notificationDeliveries)
    .innerJoin(deviceInstallations, eq(deviceInstallations.id, notificationDeliveries.deviceId))
    .innerJoin(watches, eq(watches.id, notificationDeliveries.watchId))
    .where(eq(notificationDeliveries.id, input.delivery.id));
  if (!current) return 'cancelled';
  const now = input.clock?.() ?? input.now;
  const decision = deliveryAttemptDecision({
    ticketState: current.delivery.ticketState,
    attempts: current.delivery.attempts,
    closesAt: Date.parse(input.payload.start),
    now: now.getTime(),
  });
  if (!current.watch.enabled || !current.device.enabled) {
    await db
      .update(notificationDeliveries)
      .set({
        ticketState: CANCELLED_PUSH_TICKET_STATE,
        lastError: !current.watch.enabled ? PUSH_WATCH_DISABLED : PUSH_DEVICE_DISABLED,
        updatedAt: now,
      })
      .where(and(eq(notificationDeliveries.id, current.delivery.id), pendingDeliveryCondition()));
    return decision === 'already-delivered' ? decision : 'cancelled';
  }
  if (decision === 'window-closed') await closeExpiredDelivery(current.delivery, now);
  if (decision !== 'attempt') return decision;
  const attempts = current.delivery.attempts + 1;
  let ticket: Awaited<ReturnType<typeof sendExpoPush>>;
  input.onAttempt?.();
  try {
    ticket = await sendExpoPush({
      to: current.device.expoPushToken,
      title: input.title,
      body: input.body,
      data: { ...input.payload },
    });
  } catch (error) {
    const retryable = error instanceof ExpoPushProviderError && error.retryable;
    logOperationalEvent('error', 'push.send-failed', {
      ...input.logContext,
      deliveryId: input.delivery.id,
      attempt: attempts,
      retryable,
      error,
    });
    const updated = await db
      .update(notificationDeliveries)
      .set({
        ticketState: failureState(retryable, attempts),
        attempts,
        payload: input.payload,
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'Expo push failed',
        updatedAt: input.clock?.() ?? now,
      })
      .where(and(eq(notificationDeliveries.id, input.delivery.id), pendingDeliveryCondition()))
      .returning({ id: notificationDeliveries.id });
    return updated.length ? 'failed' : 'cancelled';
  }
  const invalid = ticket.details?.error === 'DeviceNotRegistered';
  const retryable = ticket.status === 'error' && expoTicketErrorIsRetryable(ticket.details?.error);
  const ticketState = ticket.status === 'ok' ? 'ok' : failureState(retryable, attempts);
  if (ticket.status === 'error') {
    logOperationalEvent('error', 'push.ticket-error', {
      ...input.logContext,
      deliveryId: input.delivery.id,
      attempt: attempts,
      retryable,
      errorCode: ticket.details?.error ?? 'EXPO_REJECTED',
    });
  }
  // A DB failure after Expo accepts must propagate: acceptance is ambiguous until
  // persisted. Leave the intent retryable; never misclassify it as provider rejection.
  const completedAt = input.clock?.() ?? now;
  const updated = await db
    .update(notificationDeliveries)
    .set({
      ticketId: ticket.id ?? null,
      ticketState,
      attempts,
      payload: input.payload,
      sentAt: ticket.status === 'ok' ? completedAt : null,
      lastError:
        ticket.status === 'error' ? (ticket.message ?? 'Expo rejected notification') : null,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(notificationDeliveries.id, input.delivery.id),
        ticket.status === 'ok' ? undefined : pendingDeliveryCondition(),
      ),
    )
    .returning({ id: notificationDeliveries.id });
  if (invalid) {
    await db
      .update(deviceInstallations)
      .set({ enabled: false })
      .where(eq(deviceInstallations.id, input.device.id));
  }
  return ticket.status === 'ok' ? 'accepted' : updated.length ? 'failed' : 'cancelled';
}
