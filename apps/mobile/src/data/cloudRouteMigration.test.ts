/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { adaptPlannableRouteV1 } from '@runcast/core';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateCloudRouteCache } from './cloudRouteMigration';
import { hydrateCloudRoute } from './cloudRoutes';
import { fixtureBundleV2, fixtureBundleV3, NOW } from './planningBundle.fixtures';
const routeId = '00000000-0000-4000-8000-000000000001';
const summary = {
  id: routeId,
  name: 'Lakefront',
  source: 'gpx',
  origin: 'cloud-gpx',
  providerId: null,
  geometryIdentity: 'geometry',
  distance: 1000,
  importStatus: 'ready',
  version: 1,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
};
describe('atomic cloud route cache migration', () => {
  let db: DatabaseSync;
  let adapter: SQLiteDatabase;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE cache_entries(user_id TEXT,kind TEXT,cache_key TEXT,body TEXT);
      CREATE TABLE planning_bundles_v2(user_id TEXT,route_id TEXT,body TEXT,etag TEXT,installed_at INTEGER);
      CREATE TABLE cloud_routes(user_id TEXT,route_id TEXT,body TEXT,PRIMARY KEY(user_id,route_id));
      CREATE TABLE cache_migrations(id TEXT PRIMARY KEY);`);
    const methods = {
      getFirstAsync: async (sql: string, ...params: SQLInputValue[]) =>
        db.prepare(sql).get(...params) ?? null,
      getAllAsync: async (sql: string, ...params: SQLInputValue[]) =>
        db.prepare(sql).all(...params),
      runAsync: async (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params),
      withExclusiveTransactionAsync: async (work: (tx: SQLiteDatabase) => Promise<void>) => {
        db.exec('BEGIN');
        try {
          await work(adapter);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    };
    adapter = methods as unknown as SQLiteDatabase;
    db.prepare('INSERT INTO cache_entries VALUES (?,?,?,?)').run(
      'alice',
      'account',
      'routes',
      JSON.stringify([summary]),
    );
    const route = adaptPlannableRouteV1(fixtureBundleV2(routeId).route.data);
    db.prepare('INSERT INTO cache_entries VALUES (?,?,?,?)').run(
      'alice',
      'route-bundle',
      routeId,
      JSON.stringify({
        route,
        coverage: { values: ['unknown'], resolution: 50 },
        weather: null,
        timezone: 'America/Chicago',
        etag: 'old',
        weatherFetchedAt: null,
        weatherExpiresAt: null,
        version: 1,
      }),
    );
  });
  afterEach(() => db.close());
  const row = () =>
    hydrateCloudRoute(db.prepare('SELECT body FROM cloud_routes').get()!.body as string, 'alice');
  it('preserves old geometry and timezone without importing old weather', async () => {
    await migrateCloudRouteCache(adapter);
    expect(row()).toMatchObject({
      summary,
      timezone: 'America/Chicago',
      content: { kind: 'route' },
      syncState: 'unavailable',
    });
    expect(db.prepare("SELECT * FROM cache_entries WHERE kind='route-bundle'").all()).toEqual([]);
    await migrateCloudRouteCache(adapter);
    expect(db.prepare('SELECT * FROM cloud_routes').all()).toHaveLength(1);
  });
  it.each([2, 3])(
    'imports schema %s as geometry-only or verified current planning',
    async (version) => {
      const bundle = version === 3 ? fixtureBundleV3(routeId) : fixtureBundleV2(routeId);
      db.prepare('INSERT INTO planning_bundles_v2 VALUES(?,?,?,?,?)').run(
        'alice',
        routeId,
        JSON.stringify(bundle),
        'etag',
        NOW,
      );
      await migrateCloudRouteCache(adapter);
      expect(row().content.kind).toBe(version === 3 ? 'planning' : 'route');
      expect(row().timezone).toBe('America/Chicago');
      expect(db.prepare('SELECT * FROM planning_bundles_v2').all()).toEqual([]);
    },
  );
  it('rolls back source removal and migration marker when the replacement cannot be committed', async () => {
    db.exec(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON cloud_routes BEGIN SELECT RAISE(FAIL,'interrupted'); END;",
    );
    await expect(migrateCloudRouteCache(adapter)).rejects.toThrow('interrupted');
    expect(db.prepare('SELECT * FROM cache_migrations').all()).toEqual([]);
    expect(db.prepare("SELECT * FROM cache_entries WHERE kind='route-bundle'").all()).toHaveLength(
      1,
    );
    db.exec('DROP TRIGGER fail_insert');
    await migrateCloudRouteCache(adapter);
    expect(row().summary.id).toBe(routeId);
  });
});
