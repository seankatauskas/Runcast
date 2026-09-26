import { contentIdentity } from '@runcast/core';
import { Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { mutationStorageDirectory } from '../../modules/mutation-storage';
import { createMutationQueue } from './mutationQueue';
import { migrateCloudRouteCache } from './cloudRouteMigration';
import {
  hydrateCloudRoute,
  serializeCloudRoute,
  samePlanningRoute,
  type CachedCloudRoute,
} from './cloudRoutes';
import { parseAndVerifyPlanningBundle, type CachedPlanningBundle } from './planningBundle';
export type { PendingMutation } from './mutationQueue';

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

async function database() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('runcast-cache.db', {}, Paths.cache.uri)
      .then(async (db) => {
        await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cache_entries (
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          body TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, kind, cache_key)
        );
        CREATE TABLE IF NOT EXISTS pending_mutations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          body TEXT,
          idempotency_key TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending',
          error TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS pending_mutations_replay_idx
          ON pending_mutations(user_id, state, created_at);
        CREATE TABLE IF NOT EXISTS cloud_routes (
          user_id TEXT NOT NULL, route_id TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (user_id, route_id)
        );
        CREATE TABLE IF NOT EXISTS cache_migrations (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS planning_bundles_v2 (
          user_id TEXT NOT NULL,
          route_id TEXT NOT NULL,
          etag TEXT NOT NULL,
          body TEXT NOT NULL,
          bundle_id TEXT NOT NULL,
          valid_until INTEGER NOT NULL,
          installed_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, route_id)
        );
      `);
        await migrateCloudRouteCache(db);
        return db;
      })
      .catch((error: unknown) => {
        databasePromise = null;
        throw error;
      });
  }
  return databasePromise;
}

export async function cachedCloudRoutes(userId: string): Promise<CachedCloudRoute[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ body: string }>(
    'SELECT body FROM cloud_routes WHERE user_id = ?',
    userId,
  );
  return rows.flatMap(({ body }) => {
    try {
      return [hydrateCloudRoute(body, userId)];
    } catch {
      return [];
    }
  });
}

export async function putCloudRoute(row: CachedCloudRoute): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT INTO cloud_routes(user_id, route_id, body) VALUES (?, ?, ?) ON CONFLICT(user_id, route_id) DO UPDATE SET body=excluded.body',
    row.userId,
    row.summary.id,
    serializeCloudRoute(row),
  );
}

export async function cachedCloudRoute(
  userId: string,
  routeId: string,
): Promise<CachedCloudRoute | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ body: string }>(
    'SELECT body FROM cloud_routes WHERE user_id = ? AND route_id = ?',
    userId,
    routeId,
  );
  if (!row) return null;
  try {
    return hydrateCloudRoute(row.body, userId);
  } catch {
    return null;
  }
}

export async function cachedPlanningBundle(
  userId: string,
  routeId: string,
): Promise<CachedPlanningBundle | null> {
  const row = await cachedCloudRoute(userId, routeId);
  return row?.content.kind === 'planning' ? row.content.planning : null;
}

export async function installPlanningBundle(input: {
  userId: string;
  routeId: string;
  etag: string;
  body: string;
}): Promise<CachedPlanningBundle> {
  const bundle = parseAndVerifyPlanningBundle(input.body);
  if (bundle.route.data.id !== input.routeId)
    throw new Error('Planning bundle belongs to another route');
  const db = await database();
  const planning = { ...input, bundle, installedAt: Date.now() };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const stored = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM cloud_routes WHERE user_id=? AND route_id=?',
      input.userId,
      input.routeId,
    );
    if (!stored) throw new Error('Route descriptor is required before planning installation');
    const row = hydrateCloudRoute(stored.body, input.userId);
    const priorRoute =
      row.content.kind === 'planning' ? row.content.planning.bundle.route : row.content.route;
    const priorCoverage =
      row.content.kind === 'planning'
        ? row.content.planning.bundle.environment.coverage
        : row.content.woodlandEvidence;
    if (
      !samePlanningRoute(priorRoute, bundle.route) ||
      contentIdentity(priorCoverage) !== contentIdentity(bundle.environment.coverage)
    )
      throw new Error('Planning bundle does not match the current route descriptor');
    await tx.runAsync(
      'UPDATE cloud_routes SET body=? WHERE user_id=? AND route_id=?',
      serializeCloudRoute({
        ...row,
        content: { kind: 'planning', planning },
        syncState: 'modified',
      }),
      input.userId,
      input.routeId,
    );
  });
  return planning;
}

export async function putCache(
  userId: string,
  kind: string,
  key: string,
  value: unknown,
): Promise<void> {
  const db = await database();
  await db.runAsync(
    `INSERT INTO cache_entries (user_id, kind, cache_key, body, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, kind, cache_key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    userId,
    kind,
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

export async function getCache<T>(userId: string, kind: string, key: string): Promise<T | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ body: string }>(
    'SELECT body FROM cache_entries WHERE user_id = ? AND kind = ? AND cache_key = ?',
    userId,
    kind,
    key,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.body) as T;
  } catch {
    return null;
  }
}

/** Remove every purgeable artifact derived from a route that is no longer live. */
export async function deleteRouteCaches(userId: string, routeId: string): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `DELETE FROM cache_entries
        WHERE user_id = ? AND cache_key = ?
          AND kind IN ('route-bundle', 'recommendation')`,
      userId,
      routeId,
    );
    await transaction.runAsync(
      'DELETE FROM cloud_routes WHERE user_id = ? AND route_id = ?',
      userId,
      routeId,
    );
  });
}

export async function deleteWatchCaches(userId: string, watchId: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    `DELETE FROM cache_entries
      WHERE user_id = ? AND (
        (kind = 'watch-history' AND cache_key = ?) OR
        (kind = 'watch-result-detail' AND cache_key LIKE ?)
      )`,
    userId,
    watchId,
    `${watchId}:%`,
  );
}

export async function pruneWatchCaches(userId: string, liveWatchIds: string[]): Promise<void> {
  const db = await database();
  const live = new Set(liveWatchIds);
  const rows = await db.getAllAsync<{ cache_key: string }>(
    `SELECT cache_key FROM cache_entries
      WHERE user_id = ? AND kind = 'watch-history'`,
    userId,
  );
  for (const { cache_key: watchId } of rows) {
    if (!live.has(watchId)) await deleteWatchCaches(userId, watchId);
  }
}

export async function pruneRouteCaches(userId: string, liveRouteIds: string[]): Promise<void> {
  const db = await database();
  const live = new Set(liveRouteIds);
  const rows = await db.getAllAsync<{ route_id: string }>(
    'SELECT route_id FROM cloud_routes WHERE user_id = ?',
    userId,
  );
  const stale = rows.map((row) => row.route_id);
  for (const routeId of stale) {
    if (!live.has(routeId)) await deleteRouteCaches(userId, routeId);
  }
}

const mutationQueue = createMutationQueue(
  async () =>
    SQLite.openDatabaseAsync('runcast-mutations.db', {}, await mutationStorageDirectory()),
  database,
);

export const {
  enqueueMutation,
  pendingMutations,
  completeMutation,
  conflictMutation,
  readPendingPreferences,
  replacePendingPreferences,
  clearPendingPreferences,
  acknowledgePreferences,
} = mutationQueue;

export async function wipeUserCache(userId: string): Promise<void> {
  await mutationQueue.wipeUserMutations(userId);
  const db = await database();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM cache_entries WHERE user_id = ?', userId);
    await transaction.runAsync('DELETE FROM pending_mutations WHERE user_id = ?', userId);
    await transaction.runAsync('DELETE FROM planning_bundles_v2 WHERE user_id = ?', userId);
    await transaction.runAsync('DELETE FROM cloud_routes WHERE user_id = ?', userId);
  });
}
