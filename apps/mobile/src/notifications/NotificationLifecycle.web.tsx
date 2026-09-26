/**
 * expo-notifications is native-only. Deep links continue to be handled by
 * Expo Router on web, while notification response draining remains available
 * on Android and iOS through NotificationLifecycle.tsx.
 */
export function NotificationLifecycle() {
  return null;
}
