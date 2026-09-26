/// <reference types="node" />
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { contentIdentity } from '@runcast/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudRouteFromDescriptor } from './cloudRoutes';
import { fixtureBundleV3, NOW } from './planningBundle.fixtures';
const storage = vi.hoisted(() => ({ databases: new Map<string, DatabaseSync>() }));
vi.mock('expo-file-system', () => ({ Paths: { cache: { uri: '/cache' } } }));
vi.mock('../../modules/mutation-storage', () => ({
  mutationStorageDirectory: async () => '/durable',
}));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    openDatabaseAsync: async (name: string) => {
      const db = new DatabaseSync(':memory:');
      storage.databases.set(name, db);
      const methods = {
        execAsync: async (sql: string) => {
          db.exec(sql);
        },
        getFirstAsync: async (sql: string, ...params: SQLInputValue[]) =>
          db.prepare(sql).get(...params) ?? null,
        getAllAsync: async (sql: string, ...params: SQLInputValue[]) =>
          db.prepare(sql).all(...params),
        runAsync: async (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params),
        withTransactionAsync: async (work: () => Promise<void>) => {
          db.exec('BEGIN');
          try {
            await work();
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
        withExclusiveTransactionAsync: async (work: (tx: unknown) => Promise<void>) => {
          db.exec('BEGIN');
          try {
            await work(methods);
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
      };
      return methods;
    },
  };
});
const routeId = '00000000-0000-4000-8000-000000000001';
const bundle = fixtureBundleV3(routeId);
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
} as const;
const descriptor = {
  summary,
  timezone: 'America/Chicago',
  route: bundle.route,
  woodlandEvidence: bundle.environment.coverage,
};
describe('cloud route cache persistence', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    for (const db of storage.databases.values()) db.close();
    storage.databases.clear();
  });
  it('atomically replaces the route-only row with verified V3 while preserving timezone', async () => {
    const cache = await import('./cache');
    await cache.putCloudRoute(cloudRouteFromDescriptor('alice', descriptor));
    await cache.installPlanningBundle({
      userId: 'alice',
      routeId,
      etag: '"v3"',
      body: JSON.stringify(bundle),
    });
    expect(await cache.cachedCloudRoute('alice', routeId)).toMatchObject({
      timezone: 'America/Chicago',
      content: { kind: 'planning', planning: { etag: '"v3"' } },
    });
    const rows = storage.databases
      .get('runcast-cache.db')!
      .prepare('SELECT body FROM cloud_routes')
      .all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].body as string).content.planning.bundle).toBeUndefined();
  });
  it('does not replace geometry after failed validation or route mismatch', async () => {
    const cache = await import('./cache');
    const row = cloudRouteFromDescriptor('alice', descriptor);
    await cache.putCloudRoute(row);
    const tampered = structuredClone(bundle);
    tampered.environment.canopy.canopyPct[0] = 99;
    await expect(
      cache.installPlanningBundle({
        userId: 'alice',
        routeId,
        etag: 'bad',
        body: JSON.stringify(tampered),
      }),
    ).rejects.toThrow(/identity/);
    expect(await cache.cachedCloudRoute('alice', routeId)).toEqual(row);
    const data = { ...bundle.route.data, totalDistanceM: 2000 };
    const changed = cloudRouteFromDescriptor('alice', {
      ...descriptor,
      route: { ...bundle.route, data, contentHash: contentIdentity({ data }) },
    });
    await cache.putCloudRoute(changed);
    await expect(
      cache.installPlanningBundle({
        userId: 'alice',
        routeId,
        etag: 'stale',
        body: JSON.stringify(bundle),
      }),
    ).rejects.toThrow(/current route descriptor/);
    expect(await cache.cachedCloudRoute('alice', routeId)).toEqual(changed);
  });
  it('wipes cloud snapshots and durable edits only for the specified account', async () => {
    const cache = await import('./cache');
    await cache.putCloudRoute(cloudRouteFromDescriptor('alice', descriptor));
    await cache.putCloudRoute(cloudRouteFromDescriptor('bob', descriptor));
    const values = {
      units: 'metric',
      temperatureUnit: 'celsius',
      theme: 'dark',
      defaultSpeed: 3.2,
      acceptableStartMinutes: 300,
      acceptableEndMinutes: 1320,
    } as const;
    await cache.replacePendingPreferences('alice', { values, version: 1, editId: 'first' });
    await cache.wipeUserCache('alice');
    expect(await cache.cachedCloudRoutes('alice')).toEqual([]);
    expect(await cache.readPendingPreferences('alice')).toBeNull();
    expect(await cache.cachedCloudRoutes('bob')).toHaveLength(1);
  });
});
