import { notificationPayloadSchema, type NotificationPayload } from '@runcast/contracts';

export interface NotificationPayloadInput {
  route: NotificationPayload['route'];
  watch: NotificationPayload['watch'];
  delivery: NotificationPayload['delivery'];
  snapshot: NotificationPayload['snapshot'];
  startTime: number;
  url?: string;
  query?: Record<string, string>;
}

export function notificationDeepLink(
  routeId: string,
  startTime: number,
  query: Record<string, string> = {},
): string {
  const url = new URL(`runcast://routes/${encodeURIComponent(routeId)}`);
  url.searchParams.set('start', String(startTime));
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export function notificationResultDeepLink(watchId: string, evaluationId: string): string {
  return `runcast://watch-results/${encodeURIComponent(evaluationId)}?watch=${encodeURIComponent(watchId)}`;
}

export function buildNotificationPayload(input: NotificationPayloadInput): NotificationPayload {
  return notificationPayloadSchema.parse({
    schemaVersion: 1,
    type: 'watch-recommendation',
    route: input.route,
    watch: input.watch,
    delivery: input.delivery,
    snapshot: input.snapshot,
    start: new Date(input.startTime).toISOString(),
    url: input.url ?? notificationDeepLink(input.route.id, input.startTime, input.query),
  });
}
