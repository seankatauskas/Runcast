import { notificationPayloadSchema, type NotificationPayload } from '@runcast/contracts';

export interface ValidNotificationResponse {
  payload: NotificationPayload;
  target: `/routes/${string}?start=${string}` | `/watch-results/${string}?watchId=${string}`;
}

export interface MinimalNotificationSnapshot {
  deliveryId: string;
  routeId: string;
  routeName: string;
  watchId: string;
  occurrenceDate: string;
  snapshot: NotificationPayload['snapshot'];
  start: string;
}

export function notificationTarget(
  payload: NotificationPayload,
): ValidNotificationResponse['target'] | null {
  try {
    const url = new URL(payload.url);
    if (url.protocol === 'runcast:' && url.hostname === 'watch-results') {
      const evaluationId = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const watchId = url.searchParams.get('watch');
      if (
        payload.snapshot.engine !== 'planning-v2' ||
        !evaluationId ||
        evaluationId.includes('/') ||
        evaluationId !== payload.snapshot.id ||
        watchId !== payload.watch.id ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        [...url.searchParams.keys()].some((key) => key !== 'watch')
      ) {
        return null;
      }
      return `/watch-results/${encodeURIComponent(evaluationId)}?watchId=${encodeURIComponent(watchId)}`;
    }
    const routeId = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const start = Date.parse(payload.start);
    const queryStart = Number(url.searchParams.get('start'));
    const evaluation = url.searchParams.get('evaluation');
    const recommendation = url.searchParams.get('recommendation');
    const snapshotParameterMatches =
      payload.snapshot.engine === 'planning-v2'
        ? evaluation === payload.snapshot.id && recommendation === null
        : recommendation === payload.snapshot.id && evaluation === null;
    const allowedParameters = new Set([
      'start',
      payload.snapshot.engine === 'planning-v2' ? 'evaluation' : 'recommendation',
    ]);
    if (
      url.protocol !== 'runcast:' ||
      url.hostname !== 'routes' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !routeId ||
      routeId.includes('/') ||
      routeId !== payload.route.id ||
      !Number.isFinite(start) ||
      queryStart !== start ||
      !snapshotParameterMatches ||
      [...url.searchParams.keys()].some((key) => !allowedParameters.has(key))
    ) {
      return null;
    }
    return `/routes/${encodeURIComponent(routeId)}?start=${start}`;
  } catch {
    return null;
  }
}

export function parseNotificationResponseData(data: unknown): ValidNotificationResponse | null {
  const parsed = notificationPayloadSchema.safeParse(data);
  if (!parsed.success) return null;
  const target = notificationTarget(parsed.data);
  return target ? { payload: parsed.data, target } : null;
}

export function minimalNotificationSnapshot(
  payload: NotificationPayload,
): MinimalNotificationSnapshot {
  return {
    deliveryId: payload.delivery.id,
    routeId: payload.route.id,
    routeName: payload.route.name,
    watchId: payload.watch.id,
    occurrenceDate: payload.watch.occurrenceDate,
    snapshot: payload.snapshot,
    start: payload.start,
  };
}

export function addHandledDelivery(ids: string[], deliveryId: string, limit = 20): string[] {
  return [deliveryId, ...ids.filter((id) => id !== deliveryId)].slice(0, limit);
}
