import type { RouteOrigin, RouteSummary } from '@runcast/contracts';
import type { CoverageMask, PlanningRoute, Route, WoodlandEvidenceProfile } from '@runcast/core';
import * as SQLite from 'expo-sqlite';
import { normalizedRouteName, type RouteSyncIntent } from './routeLibraryModel';

export interface StoredLocalRoute {
  id: string;
  name: string;
  originalGpx: string;
  geometryIdentity: string;
  planningRoute: PlanningRoute;
  legacyRoute: Route;
  legacyCoverage: CoverageMask;
  woodlandEvidence: WoodlandEvidenceProfile;
  origin: Extract<RouteOrigin, 'local'>;
  createdAt: number;
  updatedAt: number;
}

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

async function database() {
  if (!databasePromise) {
    // No custom directory: Expo SQLite uses its durable default database
    // directory, unlike the separate forecast cache database in Paths.cache.
    databasePromise = SQLite.openDatabaseAsync('runcast-routes.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS local_routes (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          original_gpx TEXT NOT NULL,
          geometry_identity TEXT NOT NULL UNIQUE,
          planning_route TEXT NOT NULL,
          legacy_route TEXT NOT NULL,
          legacy_coverage TEXT NOT NULL,
          woodland_evidence TEXT NOT NULL,
          origin TEXT NOT NULL CHECK (origin = 'local'),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS route_sync_intents (
          user_id TEXT NOT NULL,
          route_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('rename', 'delete')),
          name TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, route_id)
        );
        CREATE INDEX IF NOT EXISTS route_sync_intents_user_idx
          ON route_sync_intents(user_id, created_at);
        CREATE TABLE IF NOT EXISTS route_promotion_intents (
          user_id TEXT NOT NULL,
          local_route_id TEXT NOT NULL,
          mutation_id TEXT NOT NULL,
          geometry_identity TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, local_route_id),
          UNIQUE (user_id, mutation_id),
          FOREIGN KEY (local_route_id) REFERENCES local_routes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS route_promotion_intents_user_idx
          ON route_promotion_intents(user_id, created_at);
      `);
      return db;
    });
  }
  return databasePromise;
}

function parseStoredRoute(row: {
  id: string;
  name: string;
  original_gpx: string;
  geometry_identity: string;
  planning_route: string;
  legacy_route: string;
  legacy_coverage: string;
  woodland_evidence: string;
  origin: 'local';
  created_at: number;
  updated_at: number;
}): StoredLocalRoute {
  return {
    id: row.id,
    name: row.name,
    originalGpx: row.original_gpx,
    geometryIdentity: row.geometry_identity,
    planningRoute: JSON.parse(row.planning_route) as PlanningRoute,
    legacyRoute: JSON.parse(row.legacy_route) as Route,
    legacyCoverage: JSON.parse(row.legacy_coverage) as CoverageMask,
    woodlandEvidence: JSON.parse(row.woodland_evidence) as WoodlandEvidenceProfile,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function storedLocalRoutes(): Promise<StoredLocalRoute[]> {
  const db = await database();
  const rows = await db.getAllAsync<Parameters<typeof parseStoredRoute>[0]>(
    `SELECT id, name, original_gpx, geometry_identity, planning_route, legacy_route,
            legacy_coverage, woodland_evidence, origin, created_at, updated_at
       FROM local_routes ORDER BY updated_at DESC, id`,
  );
  return rows.flatMap((row) => {
    try {
      return [parseStoredRoute(row)];
    } catch {
      return [];
    }
  });
}

export async function storeLocalRoute(
  route: StoredLocalRoute,
): Promise<
  { status: 'created'; route: StoredLocalRoute } | { status: 'duplicate'; route: StoredLocalRoute }
> {
  const db = await database();
  let result:
    | { status: 'created'; route: StoredLocalRoute }
    | { status: 'duplicate'; route: StoredLocalRoute }
    | undefined;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const duplicate = await transaction.getFirstAsync<Parameters<typeof parseStoredRoute>[0]>(
      `SELECT id, name, original_gpx, geometry_identity, planning_route, legacy_route,
              legacy_coverage, woodland_evidence, origin, created_at, updated_at
         FROM local_routes WHERE geometry_identity = ?`,
      route.geometryIdentity,
    );
    if (duplicate) {
      result = { status: 'duplicate', route: parseStoredRoute(duplicate) };
      return;
    }
    await transaction.runAsync(
      `INSERT INTO local_routes
        (id, name, original_gpx, geometry_identity, planning_route, legacy_route,
         legacy_coverage, woodland_evidence, origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
      route.id,
      route.name,
      route.originalGpx,
      route.geometryIdentity,
      JSON.stringify(route.planningRoute),
      JSON.stringify(route.legacyRoute),
      JSON.stringify(route.legacyCoverage),
      JSON.stringify(route.woodlandEvidence),
      route.createdAt,
      route.updatedAt,
    );
    result = { status: 'created', route };
  });
  if (!result) throw new Error('Route import transaction did not complete.');
  return result;
}

export async function updateStoredLocalRouteEnvironment(
  id: string,
  legacyCoverage: CoverageMask,
  woodlandEvidence: WoodlandEvidenceProfile,
): Promise<void> {
  const db = await database();
  await db.runAsync(
    `UPDATE local_routes
        SET legacy_coverage = ?, woodland_evidence = ?, updated_at = ?
      WHERE id = ?`,
    JSON.stringify(legacyCoverage),
    JSON.stringify(woodlandEvidence),
    Date.now(),
    id,
  );
}

export async function renameStoredLocalRoute(id: string, requestedName: string): Promise<string> {
  const name = normalizedRouteName(requestedName);
  const db = await database();
  const row = await db.getFirstAsync<{ legacy_route: string; planning_route: string }>(
    'SELECT legacy_route, planning_route FROM local_routes WHERE id = ?',
    id,
  );
  if (!row) throw new Error('Local route was not found.');
  const legacyRoute = { ...(JSON.parse(row.legacy_route) as Route), name };
  const planningRoute = { ...(JSON.parse(row.planning_route) as PlanningRoute), name };
  await db.runAsync(
    `UPDATE local_routes
        SET name = ?, legacy_route = ?, planning_route = ?, updated_at = ?
      WHERE id = ?`,
    name,
    JSON.stringify(legacyRoute),
    JSON.stringify(planningRoute),
    Date.now(),
    id,
  );
  return name;
}

export async function deleteStoredLocalRoute(id: string): Promise<void> {
  const db = await database();
  await db.runAsync('DELETE FROM local_routes WHERE id = ?', id);
}

/**
 * Mark a local route as being promoted without removing its only durable copy.
 * The marker and local row live in the same durable database, so a crash can be
 * reconciled against the server route list after the request has succeeded.
 */
export async function beginLocalRoutePromotion(
  userId: string,
  localRouteId: string,
  mutationId: string,
): Promise<boolean> {
  const db = await database();
  let started = false;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const local = await transaction.getFirstAsync<{ geometry_identity: string }>(
      'SELECT geometry_identity FROM local_routes WHERE id = ?',
      localRouteId,
    );
    if (!local) return;
    await transaction.runAsync(
      `INSERT INTO route_promotion_intents
         (user_id, local_route_id, mutation_id, geometry_identity, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, local_route_id) DO UPDATE SET
         mutation_id = excluded.mutation_id,
         geometry_identity = excluded.geometry_identity,
         created_at = excluded.created_at`,
      userId,
      localRouteId,
      mutationId,
      local.geometry_identity,
      Date.now(),
    );
    started = true;
  });
  return started;
}

/** Atomically consume a confirmed promotion and its retained local GPX. */
export async function completeLocalRoutePromotion(
  userId: string,
  mutationId: string,
): Promise<boolean> {
  const db = await database();
  let completed = false;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const intent = await transaction.getFirstAsync<{ local_route_id: string }>(
      `SELECT local_route_id FROM route_promotion_intents
        WHERE user_id = ? AND mutation_id = ?`,
      userId,
      mutationId,
    );
    if (!intent) return;
    await transaction.runAsync(
      `DELETE FROM route_promotion_intents
        WHERE user_id = ? AND mutation_id = ?`,
      userId,
      mutationId,
    );
    await transaction.runAsync('DELETE FROM local_routes WHERE id = ?', intent.local_route_id);
    completed = true;
  });
  return completed;
}

/** A terminal save failure leaves the local route intact and available. */
export async function cancelLocalRoutePromotion(userId: string, mutationId: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    `DELETE FROM route_promotion_intents
      WHERE user_id = ? AND mutation_id = ?`,
    userId,
    mutationId,
  );
}

/**
 * Recover the request-success/database-finalization crash window. A matching
 * server id or canonical geometry proves that the local route has a cloud copy.
 */
export async function reconcileSuccessfulLocalRoutePromotions(
  userId: string,
  remoteRoutes: Pick<RouteSummary, 'id' | 'geometryIdentity'>[],
): Promise<void> {
  const db = await database();
  const intents = await db.getAllAsync<{
    local_route_id: string;
    mutation_id: string;
    geometry_identity: string;
  }>(
    `SELECT local_route_id, mutation_id, geometry_identity
       FROM route_promotion_intents
      WHERE user_id = ? ORDER BY created_at, local_route_id`,
    userId,
  );
  const remoteIds = new Set(remoteRoutes.map((route) => route.id));
  const remoteGeometry = new Set(remoteRoutes.map((route) => route.geometryIdentity));
  for (const intent of intents) {
    if (remoteIds.has(intent.local_route_id) || remoteGeometry.has(intent.geometry_identity)) {
      await completeLocalRoutePromotion(userId, intent.mutation_id);
    }
  }
}

export async function putRouteSyncIntent(userId: string, intent: RouteSyncIntent): Promise<void> {
  const db = await database();
  await db.runAsync(
    `INSERT INTO route_sync_intents (user_id, route_id, kind, name, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, route_id) DO UPDATE SET
       kind = excluded.kind, name = excluded.name, created_at = excluded.created_at`,
    userId,
    intent.routeId,
    intent.kind,
    intent.name,
    intent.createdAt,
  );
}

export async function routeSyncIntents(userId: string): Promise<RouteSyncIntent[]> {
  const db = await database();
  const rows = await db.getAllAsync<{
    route_id: string;
    kind: 'rename' | 'delete';
    name: string | null;
    created_at: number;
  }>(
    `SELECT route_id, kind, name, created_at FROM route_sync_intents
      WHERE user_id = ? ORDER BY created_at, route_id`,
    userId,
  );
  const intents: RouteSyncIntent[] = [];
  for (const row of rows) {
    if (row.kind === 'rename' && row.name) {
      intents.push({
        routeId: row.route_id,
        kind: 'rename',
        name: row.name,
        createdAt: row.created_at,
      });
    } else if (row.kind === 'delete') {
      intents.push({
        routeId: row.route_id,
        kind: 'delete',
        name: null,
        createdAt: row.created_at,
      });
    }
  }
  return intents;
}

export async function clearRouteSyncIntent(
  userId: string,
  routeId: string,
  expectedCreatedAt?: number,
): Promise<void> {
  const db = await database();
  await db.runAsync(
    'DELETE FROM route_sync_intents WHERE user_id = ? AND route_id = ? AND (? IS NULL OR created_at = ?)',
    userId,
    routeId,
    expectedCreatedAt ?? null,
    expectedCreatedAt ?? null,
  );
}

export async function clearRouteSyncIntentsForUser(userId: string): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM route_sync_intents WHERE user_id = ?', userId);
    await transaction.runAsync('DELETE FROM route_promotion_intents WHERE user_id = ?', userId);
  });
}
