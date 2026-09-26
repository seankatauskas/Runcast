import type { RouteSummary } from '@runcast/contracts';

export type RouteSyncIntent =
  | { routeId: string; kind: 'rename'; name: string; createdAt: number }
  | { routeId: string; kind: 'delete'; name: null; createdAt: number };

export function normalizedRouteName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Route name cannot be empty.');
  if (normalized.length > 200) throw new Error('Route name must be 200 characters or fewer.');
  return normalized;
}

/** Apply durable offline intent before any server route reaches React state. */
export function reconcileRouteSummaries(
  remote: RouteSummary[],
  intents: RouteSyncIntent[],
): RouteSummary[] {
  const byId = new Map(intents.map((intent) => [intent.routeId, intent]));
  return remote.flatMap((route) => {
    const intent = byId.get(route.id);
    if (intent?.kind === 'delete') return [];
    if (intent?.kind === 'rename') return [{ ...route, name: intent.name }];
    return [route];
  });
}

export function staleRouteCacheIds(cachedIds: string[], liveRouteIds: string[]): string[] {
  const live = new Set(liveRouteIds);
  return cachedIds.filter((id) => !live.has(id));
}
