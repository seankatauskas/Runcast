import {
  routeDescriptorSchema,
  routeSummarySchema,
  type PlanningBundleV3,
  type RouteSummary,
} from '@runcast/contracts';
import { contentIdentity } from '@runcast/core';
import { parseAndVerifyPlanningBundle, type CachedPlanningBundle } from './planningBundle';
import type { PlanningBundleSyncState } from './planningBundleSync';
import { reconcileRouteSummaries, type RouteSyncIntent } from './routeLibraryModel';

export interface CachedCloudRoute {
  userId: string;
  summary: RouteSummary;
  timezone: string | null;
  content:
    | {
        kind: 'route';
        route: PlanningBundleV3['route'];
        woodlandEvidence: PlanningBundleV3['environment']['coverage'];
      }
    | { kind: 'planning'; planning: CachedPlanningBundle };
  syncState: PlanningBundleSyncState;
}

/** Names are presentation metadata; geometry and quality determine planning compatibility. */
export function samePlanningRoute(
  left: PlanningBundleV3['route'],
  right: PlanningBundleV3['route'],
): boolean {
  return (
    contentIdentity({ ...left.data, name: '' }) === contentIdentity({ ...right.data, name: '' })
  );
}

export function cloudRouteFromDescriptor(
  userId: string,
  raw: unknown,
  prior?: CachedCloudRoute | null,
): CachedCloudRoute {
  const descriptor = routeDescriptorSchema.parse(raw);
  if (contentIdentity({ data: descriptor.route.data }) !== descriptor.route.contentHash)
    throw new Error('Route descriptor identity does not match');
  if (descriptor.summary.id !== descriptor.route.data.id)
    throw new Error('Route descriptor ID does not match');
  const planning = prior?.content.kind === 'planning' ? prior.content.planning : null;
  const matches =
    prior?.userId === userId &&
    planning !== null &&
    samePlanningRoute(planning.bundle.route, descriptor.route) &&
    contentIdentity(planning.bundle.environment.coverage) ===
      contentIdentity(descriptor.woodlandEvidence);
  return {
    userId,
    summary: descriptor.summary,
    timezone: descriptor.timezone,
    content:
      matches && planning
        ? { kind: 'planning', planning }
        : {
            kind: 'route',
            route: descriptor.route,
            woodlandEvidence: descriptor.woodlandEvidence,
          },
    syncState: matches ? prior!.syncState : 'unavailable',
  };
}

export function hydrateCloudRoute(raw: string, userId: string): CachedCloudRoute {
  const value = JSON.parse(raw) as CachedCloudRoute;
  if (value.userId !== userId) throw new Error('Cloud route belongs to another account');
  const summary = routeSummarySchema.parse(value.summary);
  if (value.timezone !== null && (typeof value.timezone !== 'string' || !value.timezone))
    throw new Error('Invalid route timezone');
  if (
    !['modified', 'not-modified', 'preparing', 'unavailable', 'update-required'].includes(
      value.syncState,
    )
  )
    throw new Error('Invalid route sync state');
  if (value.content.kind === 'planning') {
    const planning = value.content.planning;
    const bundle = parseAndVerifyPlanningBundle(planning.body);
    if (
      planning.userId !== userId ||
      planning.routeId !== summary.id ||
      bundle.route.data.id !== summary.id
    )
      throw new Error('Cloud planning route identity does not match');
    return { ...value, summary, content: { kind: 'planning', planning: { ...planning, bundle } } };
  }
  // Migrated geometry may have no known timezone. Validate the route and evidence
  // with the descriptor contract without inventing a timezone for its consumers.
  const parsed = cloudRouteFromDescriptor(userId, {
    summary,
    timezone: value.timezone ?? 'UTC',
    route: value.content.route,
    woodlandEvidence: value.content.woodlandEvidence,
  });
  return { ...parsed, timezone: value.timezone, syncState: value.syncState };
}

/** One optimistic projection; cached server snapshots and bundle hashes stay untouched. */
export function projectCloudRoutes(
  rows: CachedCloudRoute[],
  summaries: RouteSummary[],
  intents: RouteSyncIntent[],
): CachedCloudRoute[] {
  const visible = new Map(
    reconcileRouteSummaries(summaries, intents).map((summary) => [summary.id, summary]),
  );
  return rows.flatMap((row) => {
    const summary = visible.get(row.summary.id);
    return summary ? [{ ...row, summary }] : [];
  });
}

export function serializeCloudRoute(row: CachedCloudRoute): string {
  if (row.content.kind === 'route') return JSON.stringify(row);
  const { bundle: _verifiedInMemory, ...stored } = row.content.planning;
  return JSON.stringify({ ...row, content: { kind: 'planning', planning: stored } });
}
