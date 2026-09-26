import type { NotificationPayload } from '@runcast/contracts';
import { parseNotificationResponseData } from './responseModel';

export interface NotificationDrainMemory {
  processing: Set<string>;
  navigated: Set<string>;
  directedToAccount: Set<string>;
}

export async function drainNotificationResponses(input: {
  status: 'hydrating' | 'guest' | 'authenticated';
  pending: NotificationPayload[];
  memory: NotificationDrainMemory;
  navigateRoute: (
    target: `/routes/${string}?start=${string}` | `/watch-results/${string}?watchId=${string}`,
  ) => void;
  navigateAccount: () => void;
  consume: (payload: NotificationPayload) => Promise<unknown>;
  complete: (deliveryId: string) => Promise<void>;
}): Promise<void> {
  for (const payload of input.pending) {
    const deliveryId = payload.delivery.id;
    const parsed = parseNotificationResponseData(payload);
    if (!parsed) {
      await input.complete(deliveryId);
      continue;
    }
    if (input.status === 'guest') {
      if (!input.memory.directedToAccount.has(deliveryId)) {
        input.memory.directedToAccount.add(deliveryId);
        input.navigateAccount();
      }
      continue;
    }
    if (input.status !== 'authenticated') continue;
    if (input.memory.processing.has(deliveryId)) continue;
    input.memory.processing.add(deliveryId);
    let shouldNavigate = true;
    try {
      const result = await input.consume(payload);
      shouldNavigate = result !== 'discarded';
      await input.complete(deliveryId);
    } catch {
      // The durable pending queue is retried by the next event/foreground/session drain.
    } finally {
      input.memory.processing.delete(deliveryId);
    }
    if (shouldNavigate && !input.memory.navigated.has(deliveryId)) {
      input.memory.navigated.add(deliveryId);
      input.navigateRoute(parsed.target);
    }
  }
}
