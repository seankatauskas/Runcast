import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { drainNotificationResponses, type NotificationDrainMemory } from './responseDrain';
import { parseNotificationResponseData } from './responseModel';
import {
  completeNotificationResponse,
  pendingNotificationResponses,
  queueNotificationResponse,
} from './responseStore';

export function NotificationLifecycle() {
  const auth = useAuth();
  const router = useRouter();
  const memory = useRef<NotificationDrainMemory>({
    processing: new Set(),
    navigated: new Set(),
    directedToAccount: new Set(),
  });
  const [queueRevision, queueChanged] = useReducer((revision: number) => revision + 1, 0);

  const accept = useCallback(
    async (response: Notifications.NotificationResponse): Promise<void> => {
      const parsed = parseNotificationResponseData(response.notification.request.content.data);
      if (!parsed) {
        Notifications.clearLastNotificationResponse();
        return;
      }
      await queueNotificationResponse(parsed.payload);
      Notifications.clearLastNotificationResponse();
      queueChanged();
    },
    [],
  );

  useEffect(() => {
    const initial = Notifications.getLastNotificationResponse();
    if (initial) void accept(initial).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void accept(response).catch(() => undefined);
    });
    const foreground = AppState.addEventListener('change', (next) => {
      if (next === 'active') queueChanged();
    });
    return () => {
      subscription.remove();
      foreground.remove();
    };
  }, [accept]);

  useEffect(() => {
    let cancelled = false;
    void pendingNotificationResponses().then((pending) => {
      if (cancelled) return;
      return drainNotificationResponses({
        status: auth.status,
        pending,
        memory: memory.current,
        navigateRoute: (target) => router.replace(target),
        navigateAccount: () => router.push('/account'),
        consume: auth.consumeNotificationOpen,
        complete: completeNotificationResponse,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.consumeNotificationOpen, queueRevision, router]);

  return null;
}
