import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationPayloadSchema, type NotificationPayload } from '@runcast/contracts';
import { addHandledDelivery } from './responseModel';

const PENDING_KEY = 'runcast.notification-responses.pending.v1';
const HANDLED_KEY = 'runcast.notification-responses.handled.v1';
let updateChain = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const current = updateChain.catch(() => undefined).then(operation);
  updateChain = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

async function readHandled(): Promise<string[]> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(HANDLED_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function pendingNotificationResponses(): Promise<NotificationPayload[]> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      const payload = notificationPayloadSchema.safeParse(candidate);
      return payload.success ? [payload.data] : [];
    });
  } catch {
    return [];
  }
}

/** Returns true only for the first native event that queues this delivery. */
export function queueNotificationResponse(payload: NotificationPayload): Promise<boolean> {
  return serialized(async () => {
    const [handled, pending] = await Promise.all([readHandled(), pendingNotificationResponses()]);
    if (
      handled.includes(payload.delivery.id) ||
      pending.some((candidate) => candidate.delivery.id === payload.delivery.id)
    ) {
      return false;
    }
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify([...pending, payload].slice(-10)));
    return true;
  });
}

export function completeNotificationResponse(deliveryId: string): Promise<void> {
  return serialized(async () => {
    const [handled, pending] = await Promise.all([readHandled(), pendingNotificationResponses()]);
    await Promise.all([
      AsyncStorage.setItem(HANDLED_KEY, JSON.stringify(addHandledDelivery(handled, deliveryId))),
      AsyncStorage.setItem(
        PENDING_KEY,
        JSON.stringify(pending.filter((payload) => payload.delivery.id !== deliveryId)),
      ),
    ]);
  });
}
