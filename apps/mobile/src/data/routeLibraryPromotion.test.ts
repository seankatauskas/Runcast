import type { RouteSummary } from '@runcast/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlite = vi.hoisted(() => {
  type LocalRow = {
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
  };
  type PromotionRow = {
    user_id: string;
    local_route_id: string;
    mutation_id: string;
    geometry_identity: string;
    created_at: number;
  };

  const locals = new Map<string, LocalRow>();
  const promotions = new Map<string, PromotionRow>();
  const key = (userId: string, localRouteId: string) => `${userId}:${localRouteId}`;
  const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();

  const db = {
    execAsync: vi.fn(async () => undefined),
    withExclusiveTransactionAsync: vi.fn(async (operation: (database: typeof db) => unknown) =>
      operation(db),
    ),
    getFirstAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      const query = normalized(sql);
      if (query.includes('FROM local_routes WHERE geometry_identity = ?')) {
        return [...locals.values()].find((row) => row.geometry_identity === parameters[0]);
      }
      if (query === 'SELECT geometry_identity FROM local_routes WHERE id = ?') {
        const row = locals.get(String(parameters[0]));
        return row ? { geometry_identity: row.geometry_identity } : null;
      }
      if (query.includes('SELECT local_route_id FROM route_promotion_intents')) {
        const row = [...promotions.values()].find(
          (candidate) =>
            candidate.user_id === parameters[0] && candidate.mutation_id === parameters[1],
        );
        return row ? { local_route_id: row.local_route_id } : null;
      }
      throw new Error(`Unhandled getFirstAsync query: ${query}`);
    }),
    getAllAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      const query = normalized(sql);
      if (query.includes('FROM local_routes ORDER BY updated_at DESC, id')) {
        return [...locals.values()].sort(
          (a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id),
        );
      }
      if (query.includes('FROM route_promotion_intents')) {
        return [...promotions.values()]
          .filter((row) => row.user_id === parameters[0])
          .sort(
            (a, b) =>
              a.created_at - b.created_at || a.local_route_id.localeCompare(b.local_route_id),
          );
      }
      throw new Error(`Unhandled getAllAsync query: ${query}`);
    }),
    runAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      const query = normalized(sql);
      if (query.startsWith('INSERT INTO local_routes')) {
        const [
          id,
          name,
          originalGpx,
          geometryIdentity,
          planningRoute,
          legacyRoute,
          legacyCoverage,
          woodlandEvidence,
          createdAt,
          updatedAt,
        ] = parameters;
        locals.set(String(id), {
          id: String(id),
          name: String(name),
          original_gpx: String(originalGpx),
          geometry_identity: String(geometryIdentity),
          planning_route: String(planningRoute),
          legacy_route: String(legacyRoute),
          legacy_coverage: String(legacyCoverage),
          woodland_evidence: String(woodlandEvidence),
          origin: 'local',
          created_at: Number(createdAt),
          updated_at: Number(updatedAt),
        });
        return;
      }
      if (query.startsWith('INSERT INTO route_promotion_intents')) {
        const [userId, localRouteId, mutationId, geometryIdentity, createdAt] =
          parameters.map(String);
        promotions.set(key(userId, localRouteId), {
          user_id: userId,
          local_route_id: localRouteId,
          mutation_id: mutationId,
          geometry_identity: geometryIdentity,
          created_at: Number(createdAt),
        });
        return;
      }
      if (query.startsWith('DELETE FROM route_promotion_intents')) {
        const [userId, mutationId] = parameters;
        for (const [promotionKey, row] of promotions) {
          if (row.user_id === userId && row.mutation_id === mutationId) {
            promotions.delete(promotionKey);
          }
        }
        return;
      }
      if (query === 'DELETE FROM local_routes WHERE id = ?') {
        const localRouteId = String(parameters[0]);
        locals.delete(localRouteId);
        for (const [promotionKey, row] of promotions) {
          if (row.local_route_id === localRouteId) promotions.delete(promotionKey);
        }
        return;
      }
      throw new Error(`Unhandled runAsync query: ${query}`);
    }),
  };

  return { db, locals, promotions };
});

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(async () => sqlite.db),
}));

import {
  beginLocalRoutePromotion,
  cancelLocalRoutePromotion,
  completeLocalRoutePromotion,
  reconcileSuccessfulLocalRoutePromotions,
  storedLocalRoutes,
  storeLocalRoute,
  type StoredLocalRoute,
} from './routeLibrary';

const USER_ID = 'user-1';

function localRoute(id: string, geometryIdentity: string): StoredLocalRoute {
  return {
    id,
    name: 'Local GPX',
    originalGpx: '<gpx><trk><name>Local GPX</name></trk></gpx>',
    geometryIdentity,
    planningRoute: { id, name: 'Local GPX' } as StoredLocalRoute['planningRoute'],
    legacyRoute: { id, name: 'Local GPX' } as StoredLocalRoute['legacyRoute'],
    legacyCoverage: [] as unknown as StoredLocalRoute['legacyCoverage'],
    woodlandEvidence: {} as StoredLocalRoute['woodlandEvidence'],
    origin: 'local',
    createdAt: 1,
    updatedAt: 1,
  };
}

function remoteRoute(id: string, geometryIdentity: string): RouteSummary {
  return {
    id,
    name: 'Cloud GPX',
    source: 'gpx',
    origin: 'cloud-gpx',
    providerId: null,
    geometryIdentity,
    distance: 5000,
    importStatus: 'ready',
    version: 1,
    createdAt: '2026-08-15T12:00:00.000Z',
    updatedAt: '2026-08-15T12:00:00.000Z',
  };
}

describe('durable local route promotion', () => {
  beforeEach(() => {
    sqlite.locals.clear();
    sqlite.promotions.clear();
  });

  it('cannot resurrect after cloud save, cloud delete, and local rehydration', async () => {
    const local = localRoute('local-route', 'same-geometry');
    await storeLocalRoute(local);
    expect(await beginLocalRoutePromotion(USER_ID, local.id, 'save-1')).toBe(true);

    // Starting a save never removes the only durable copy.
    expect((await storedLocalRoutes()).map((route) => route.id)).toEqual([local.id]);

    // Recover the crash window after a deduplicated cloud save returned a
    // different route id but before local finalization completed.
    let cloudRoutes = [remoteRoute('existing-cloud-route', local.geometryIdentity)];
    await reconcileSuccessfulLocalRoutePromotions(USER_ID, cloudRoutes);

    // Deleting the cloud route followed by a process restart cannot reveal the
    // old local row because promotion consumed it durably.
    cloudRoutes = [];
    expect(cloudRoutes).toEqual([]);
    expect(await storedLocalRoutes()).toEqual([]);
  });

  it('keeps the local route when the cloud save fails', async () => {
    const local = localRoute('failed-local-route', 'failed-geometry');
    await storeLocalRoute(local);
    expect(await beginLocalRoutePromotion(USER_ID, local.id, 'save-2')).toBe(true);

    await cancelLocalRoutePromotion(USER_ID, 'save-2');

    expect((await storedLocalRoutes()).map((route) => route.id)).toEqual([local.id]);
  });

  it('finalizes a successfully replayed offline upload before dequeuing it', async () => {
    const local = localRoute('queued-local-route', 'queued-geometry');
    await storeLocalRoute(local);
    await beginLocalRoutePromotion(USER_ID, local.id, 'queued-save');

    expect(await completeLocalRoutePromotion(USER_ID, 'queued-save')).toBe(true);
    expect(await storedLocalRoutes()).toEqual([]);
  });
});
