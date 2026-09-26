import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const GPX =
  '<gpx><trk><name>Test route</name><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
const strava = vi.hoisted(() => ({ list: vi.fn(), export: vi.fn() }));
vi.mock('../providers/strava', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../providers/strava')>()),
  listStravaRoutes: strava.list,
  exportStravaRoute: strava.export,
}));

import { buildApp } from '../app';
import { mutateIdempotently } from '../idempotency';
import { encryptSecret } from '../security/crypto';
import { createSession } from '../session';
import { closeDatabase, db, sql } from './client';
import { idempotencyKeys, routes, stravaConnections, users, watches } from './schema';

const integration = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;

integration('atomic mutation replay and concurrent writes', () => {
  let app: FastifyInstance;
  let userId: string;
  let headers: { authorization: string };

  beforeAll(async () => {
    app = await buildApp();
    // Fault injection occurs after the domain write, at replay-record insertion.
    await sql`CREATE OR REPLACE FUNCTION test_mutation_record_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW.key = 'test-injected-record-failure' THEN
          RAISE EXCEPTION 'injected replay record failure';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`;
    await sql`CREATE TRIGGER test_mutation_record_failure BEFORE INSERT ON idempotency_keys
      FOR EACH ROW EXECUTE FUNCTION test_mutation_record_failure()`;
    // Ensure both concurrent handlers read version 1 before either update commits.
    await sql`CREATE OR REPLACE FUNCTION test_mutation_slow_rename() RETURNS trigger AS $$
      BEGIN
        IF NEW.name LIKE 'Concurrent rename%' THEN PERFORM pg_sleep(0.15); END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`;
    await sql`CREATE TRIGGER test_mutation_slow_rename BEFORE UPDATE ON routes
      FOR EACH ROW EXECUTE FUNCTION test_mutation_slow_rename()`;
  });

  beforeEach(async () => {
    const [user] = await db.insert(users).values({ displayName: 'Mutation test' }).returning();
    userId = user.id;
    const session = await createSession(userId, randomUUID());
    headers = { authorization: `Bearer ${session.accessToken}` };
    strava.list
      .mockReset()
      .mockResolvedValue([{ id: 'provider-route', name: 'Strava route', private: false }]);
    strava.export.mockReset().mockResolvedValue(GPX);
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  afterAll(async () => {
    await sql`DROP TRIGGER IF EXISTS test_mutation_record_failure ON idempotency_keys`;
    await sql`DROP FUNCTION IF EXISTS test_mutation_record_failure()`;
    await sql`DROP TRIGGER IF EXISTS test_mutation_slow_rename ON routes`;
    await sql`DROP FUNCTION IF EXISTS test_mutation_slow_rename()`;
    await app.close();
    await closeDatabase();
  });

  async function importRoute(key: string = randomUUID()) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers,
      payload: { gpx: GPX, idempotencyKey: key },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  async function createWatch(routeId: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/watches',
      headers,
      payload: {
        routeId,
        weekdays: (1 << 1) | (1 << 3) | (1 << 5),
        timezone: 'UTC',
        startMinutes: 360,
        endMinutes: 480,
        speed: 3,
        leadMinutes: 60,
        enabled: true,
        idempotencyKey: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it('commits one GPX import and one replay response for concurrent matching keys', async () => {
    const request = {
      method: 'POST' as const,
      url: '/v1/routes/gpx',
      headers,
      payload: { gpx: GPX, idempotencyKey: 'same-gpx-request' },
    };
    const responses = await Promise.all([app.inject(request), app.inject(request)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(responses[0].json()).toEqual(responses[1].json());
    expect(await db.select().from(routes).where(eq(routes.ownerId, userId))).toHaveLength(1);
    expect(
      await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, userId)),
    ).toHaveLength(1);
  });

  it('deduplicates concurrent geometry imports with different keys', async () => {
    const responses = await Promise.all(
      ['first-import-key', 'other-import-key'].map((idempotencyKey) =>
        app.inject({
          method: 'POST',
          url: '/v1/routes/gpx',
          headers,
          payload: { gpx: GPX, idempotencyKey },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(responses[0].json().id).toBe(responses[1].json().id);
    expect(await db.select().from(routes).where(eq(routes.ownerId, userId))).toHaveLength(1);
  });

  it('rolls back an import if recording its replay response fails', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers,
      payload: { gpx: GPX, idempotencyKey: 'test-injected-record-failure' },
    });
    expect(response.statusCode).toBe(500);
    expect(await db.select().from(routes).where(eq(routes.ownerId, userId))).toHaveLength(0);
    expect(
      await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, userId)),
    ).toHaveLength(0);
    await importRoute();
  });

  it('replays one route rename for concurrent matching keys, even after a later edit', async () => {
    const route = await importRoute();
    const request = {
      method: 'PATCH' as const,
      url: `/v1/routes/${route.id}`,
      headers,
      payload: { name: 'First rename', version: route.version, idempotencyKey: 'same-rename-key' },
    };
    const responses = await Promise.all([app.inject(request), app.inject(request)]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0].json()).toEqual(responses[1].json());
    expect(responses[0].json().version).toBe(2);
    const later = await app.inject({
      ...request,
      payload: { name: 'Later rename', version: 2, idempotencyKey: 'later-rename-key' },
    });
    expect(later.statusCode).toBe(200);
    expect((await app.inject(request)).json()).toEqual(responses[0].json());
  });

  it('rejects a concurrent rename with a different key and the same version', async () => {
    const route = await importRoute();
    const responses = await Promise.all(
      ['one', 'two'].map((suffix) =>
        app.inject({
          method: 'PATCH',
          url: `/v1/routes/${route.id}`,
          headers,
          payload: {
            name: `Concurrent rename ${suffix}`,
            version: route.version,
            idempotencyKey: `rename-key-${suffix}`,
          },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const [stored] = await db.select().from(routes).where(eq(routes.id, route.id));
    expect(stored.version).toBe(2);
    expect(stored.name).toBe(
      responses.find((response) => response.statusCode === 200)!.json().name,
    );
  });

  it('rolls back a rename if recording the replay response fails', async () => {
    const route = await importRoute();
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/routes/${route.id}`,
      headers,
      payload: {
        name: 'Failed rename',
        version: 1,
        idempotencyKey: 'test-injected-record-failure',
      },
    });
    expect(response.statusCode).toBe(500);
    const [stored] = await db.select().from(routes).where(eq(routes.id, route.id));
    expect(stored.version).toBe(1);
    expect(stored.name).toBe(route.name);
  });

  it('replays one watch update for concurrent matching keys, even after a later edit', async () => {
    const route = await importRoute();
    const watch = await createWatch(route.id);
    const request = {
      method: 'PATCH' as const,
      url: `/v1/watches/${watch.id}`,
      headers,
      payload: { speed: 3.5, version: watch.version, idempotencyKey: 'same-watch-update' },
    };
    const responses = await Promise.all([app.inject(request), app.inject(request)]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0].json()).toEqual(responses[1].json());
    expect(responses[0].json().version).toBe(2);
    expect(
      (
        await app.inject({
          ...request,
          payload: { speed: 4, version: 2, idempotencyKey: 'later-watch-edit' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject(request)).json()).toEqual(responses[0].json());
  });

  it('rejects concurrent watch updates with different keys and the same version', async () => {
    const watch = await createWatch((await importRoute()).id);
    const responses = await Promise.all(
      [3.5, 4].map((speed) =>
        app.inject({
          method: 'PATCH',
          url: `/v1/watches/${watch.id}`,
          headers,
          payload: { speed, version: watch.version, idempotencyKey: `watch-speed-${speed}` },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const [stored] = await db.select().from(watches).where(eq(watches.id, watch.id));
    expect(stored.version).toBe(2);
  });

  it('rolls back a watch update if recording the replay response fails', async () => {
    const watch = await createWatch((await importRoute()).id);
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/watches/${watch.id}`,
      headers,
      payload: { speed: 4, version: 1, idempotencyKey: 'test-injected-record-failure' },
    });
    expect(response.statusCode).toBe(500);
    const [stored] = await db.select().from(watches).where(eq(watches.id, watch.id));
    expect(stored.version).toBe(1);
    expect(stored.speed).toBe(watch.speed);
  });

  it('rolls back a failed mutation and permits retry with the same key', async () => {
    const mutate = vi.fn(async (tx: Parameters<Parameters<typeof mutateIdempotently>[3]>[0]) => {
      await tx.update(users).set({ displayName: 'Committed name' }).where(eq(users.id, userId));
      if (mutate.mock.calls.length === 1) throw new Error('simulated interruption');
      return { name: 'Committed name' };
    });
    await expect(mutateIdempotently(userId, 'test:retry', 'retry-key', mutate)).rejects.toThrow(
      'simulated interruption',
    );
    expect((await db.select().from(users).where(eq(users.id, userId)))[0].displayName).toBe(
      'Mutation test',
    );
    expect((await mutateIdempotently(userId, 'test:retry', 'retry-key', mutate)).replay).toBe(
      false,
    );
    expect((await mutateIdempotently(userId, 'test:retry', 'retry-key', mutate)).replay).toBe(true);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('commits and replays concurrent Strava imports, without refetching on later replay', async () => {
    await db.insert(stravaConnections).values({
      userId,
      athleteId: randomUUID(),
      accessTokenEncrypted: encryptSecret('access'),
      refreshTokenEncrypted: encryptSecret('refresh'),
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['read'],
    });
    const request = {
      method: 'POST' as const,
      url: '/v1/routes/strava/provider-route/import',
      headers,
      payload: { idempotencyKey: 'same-strava-import' },
    };
    const responses = await Promise.all([app.inject(request), app.inject(request)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(responses[0].json()).toEqual(responses[1].json());
    strava.list.mockClear();
    strava.export.mockClear();
    expect((await app.inject(request)).json()).toEqual(responses[0].json());
    expect(strava.list).not.toHaveBeenCalled();
    expect(strava.export).not.toHaveBeenCalled();
    expect(
      await db
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.operation, 'route:strava:provider-route'),
          ),
        ),
    ).toHaveLength(1);
  });

  it('returns the committed response for a reused key or a watch deleted after success', async () => {
    const watch = await createWatch((await importRoute()).id);
    const request = {
      method: 'PATCH' as const,
      url: `/v1/watches/${watch.id}`,
      headers,
      payload: { speed: 3.5, version: 1, idempotencyKey: 'replay-deleted-watch' },
    };
    const original = await app.inject(request);
    expect(original.statusCode).toBe(200);
    const reused = await app.inject({ ...request, payload: { ...request.payload, speed: 4 } });
    expect(reused.json()).toEqual(original.json());
    expect((await app.inject({ method: 'DELETE', url: request.url, headers })).statusCode).toBe(
      204,
    );
    expect((await app.inject(request)).json()).toEqual(original.json());
    expect(
      (
        await app.inject({
          ...request,
          payload: { ...request.payload, idempotencyKey: 'new-deleted-watch' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('does not replay another user mutation or allow a foreign route rename', async () => {
    const route = await importRoute('owner-import-key');
    const [other] = await db.insert(users).values({ displayName: 'Other owner' }).returning();
    try {
      const session = await createSession(other.id, randomUUID());
      const foreignHeaders = { authorization: `Bearer ${session.accessToken}` };
      const rename = await app.inject({
        method: 'PATCH',
        url: `/v1/routes/${route.id}`,
        headers: foreignHeaders,
        payload: { name: 'Foreign rename', version: 1, idempotencyKey: 'owner-import-key' },
      });
      expect(rename.statusCode).toBe(404);
      const foreignImport = await app.inject({
        method: 'POST',
        url: '/v1/routes/gpx',
        headers: foreignHeaders,
        payload: { gpx: GPX, idempotencyKey: 'owner-import-key' },
      });
      expect(foreignImport.statusCode).toBe(201);
      expect(foreignImport.json().id).not.toBe(route.id);
    } finally {
      await db.delete(users).where(eq(users.id, other.id));
    }
  });

  it('rolls back Strava imports if replay-record persistence fails', async () => {
    await db.insert(stravaConnections).values({
      userId,
      athleteId: randomUUID(),
      accessTokenEncrypted: encryptSecret('access'),
      refreshTokenEncrypted: encryptSecret('refresh'),
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['read'],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/routes/strava/provider-route/import',
      headers,
      payload: { idempotencyKey: 'test-injected-record-failure' },
    });
    expect(response.statusCode).toBe(500);
    expect(await db.select().from(routes).where(eq(routes.ownerId, userId))).toHaveLength(0);
  });

  it('increments the route version on provider geometry replacement and preserves canonical IDs', async () => {
    await db.insert(stravaConnections).values({
      userId,
      athleteId: randomUUID(),
      accessTokenEncrypted: encryptSecret('access'),
      refreshTokenEncrypted: encryptSecret('refresh'),
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['read'],
    });
    const request = {
      method: 'POST' as const,
      url: '/v1/routes/strava/provider-route/import',
      headers,
      payload: { idempotencyKey: 'initial-strava-geometry' },
    };
    const original = await app.inject(request);
    expect(original.statusCode).toBe(201);
    strava.export.mockResolvedValue(GPX.replace('41.01', '41.02'));
    const changed = await app.inject({
      ...request,
      payload: { idempotencyKey: 'changed-strava-geometry' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().id).toBe(original.json().id);
    expect(changed.json().version).toBe(2);
    const [stored] = await db.select().from(routes).where(eq(routes.id, original.json().id));
    expect(stored.canonicalRoute.id).toBe(stored.id);
    expect(stored.canonicalRouteV2?.id).toBe(stored.id);
    const staleRename = await app.inject({
      method: 'PATCH',
      url: `/v1/routes/${stored.id}`,
      headers,
      payload: { name: 'Stale name', version: 1, idempotencyKey: 'stale-provider-rename' },
    });
    expect(staleRename.statusCode).toBe(409);
  });
});
