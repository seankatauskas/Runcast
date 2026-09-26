/// <reference types="node" />
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMutationQueue, type PendingMutation } from './mutationQueue';
import { createPreferenceSyncCoordinator } from './preferenceSync';
import type { AccountScope } from '../auth/accountScope';

// Execute production SQL against disk-backed SQLite, including real rollback
// and reopen behavior. Only the Expo asynchronous adapter is replaced.
function sqlite(path: string) {
  const native = new DatabaseSync(path);
  const adapter = {
    execAsync: async (sql: string) => {
      native.exec(sql);
    },
    runAsync: async (sql: string, ...params: SQLInputValue[]) => native.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, ...params: SQLInputValue[]) =>
      native.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, ...params: SQLInputValue[]) =>
      native.prepare(sql).all(...params),
    withExclusiveTransactionAsync: async (work: (db: SQLiteDatabase) => Promise<void>) => {
      await adapter.withTransactionAsync(() => work(adapter as unknown as SQLiteDatabase));
    },
    withTransactionAsync: async (work: () => Promise<void>) => {
      native.exec('BEGIN IMMEDIATE');
      try {
        await work();
        native.exec('COMMIT');
      } catch (error) {
        native.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { native, adapter: adapter as unknown as SQLiteDatabase };
}

const mutation = (id: string, userId = 'alice'): PendingMutation => ({
  id,
  userId,
  method: 'PATCH',
  path: `/v1/watches/${id}`,
  body: { enabled: false, expectedVersion: 2 },
  idempotencyKey: `key-${id}`,
});

describe('durable offline mutations', () => {
  let directory: string;
  let durable: ReturnType<typeof sqlite>;
  let legacy: ReturnType<typeof sqlite>;
  const openQueue = () =>
    createMutationQueue(
      async () => durable.adapter,
      async () => legacy.adapter,
    );
  const seed = (id: string, state = 'pending', userId = 'alice') =>
    legacy.native
      .prepare(`INSERT INTO pending_mutations VALUES (?, ?, 'PATCH', ?, ?, ?, ?, ?, 123)`)
      .run(
        id,
        userId,
        `/v1/watches/${id}`,
        JSON.stringify({ enabled: false }),
        `key-${id}`,
        state,
        state === 'conflict' ? 'Version conflict' : null,
      );

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'runcast-queue-'));
    durable = sqlite(join(directory, 'durable.db'));
    legacy = sqlite(join(directory, 'cache.db'));
    legacy.native.exec(`CREATE TABLE pending_mutations (
      id TEXT PRIMARY KEY, user_id TEXT, method TEXT, path TEXT, body TEXT,
      idempotency_key TEXT, state TEXT, error TEXT, created_at INTEGER
    ); CREATE TABLE cache_entries(user_id TEXT,kind TEXT,cache_key TEXT,body TEXT)`);
  });
  afterEach(() => {
    durable.native.close();
    legacy.native.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('preserves pending/conflicted edits, their identity, and account isolation during migration', async () => {
    seed('a');
    seed('conflict', 'conflict');
    seed('b', 'pending', 'bob');
    const queue = openQueue();
    expect(await queue.pendingMutations('alice')).toEqual([
      {
        ...mutation('a'),
        body: { enabled: false },
      },
    ]);
    expect((await queue.pendingMutations('bob')).map((row) => row.id)).toEqual(['b']);
    expect(
      durable.native
        .prepare('SELECT state, error, created_at FROM pending_mutations WHERE id = ?')
        .get('conflict'),
    ).toMatchObject({ state: 'conflict', error: 'Version conflict', created_at: 123 });
    expect(legacy.native.prepare('SELECT * FROM pending_mutations').all()).toEqual([]);
  });

  it('survives complete cache eviction and process restart', async () => {
    await openQueue().enqueueMutation(mutation('durable'));
    durable.native.close();
    legacy.native.close();
    rmSync(join(directory, 'cache.db'));
    durable = sqlite(join(directory, 'durable.db'));
    legacy = sqlite(join(directory, 'cache.db'));
    // The response-cache bootstrap recreates its legacy table after eviction.
    legacy.native.exec(
      'CREATE TABLE pending_mutations (id TEXT PRIMARY KEY); CREATE TABLE cache_entries(user_id TEXT,kind TEXT,cache_key TEXT,body TEXT)',
    );
    expect(await openQueue().pendingMutations('alice')).toEqual([mutation('durable')]);
  });

  it('rolls back a partially copied migration and retries without losing source rows', async () => {
    seed('a');
    seed('b');
    const originalRun = durable.adapter.runAsync.bind(durable.adapter);
    durable.adapter.runAsync = (async (sql: string, ...params: (string | number | null)[]) => {
      if (params[0] === 'b') throw new Error('simulated crash while copying');
      return originalRun(sql, ...params);
    }) as SQLiteDatabase['runAsync'];
    const queue = openQueue();
    await expect(queue.pendingMutations('alice')).rejects.toThrow('simulated crash');
    expect(durable.native.prepare('SELECT * FROM pending_mutations').all()).toEqual([]);
    expect(legacy.native.prepare('SELECT * FROM pending_mutations').all()).toHaveLength(2);
    durable.adapter.runAsync = originalRun;
    expect((await queue.pendingMutations('alice')).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('does not resurrect completed edits after a crash between durable commit and cache cleanup', async () => {
    seed('a');
    const originalRun = legacy.adapter.runAsync.bind(legacy.adapter);
    legacy.adapter.runAsync = (async () => {
      throw new Error('crash before cleanup');
    }) as SQLiteDatabase['runAsync'];
    await expect(openQueue().pendingMutations('alice')).rejects.toThrow('crash before cleanup');
    expect(durable.native.prepare('SELECT * FROM pending_mutations').all()).toHaveLength(1);
    // Another completed initialization may have replayed this edit; stale cache
    // data must never override the durable migration marker after restart.
    durable.native.exec('DELETE FROM pending_mutations');
    legacy.adapter.runAsync = originalRun;
    expect(await openQueue().pendingMutations('alice')).toEqual([]);
    expect(legacy.native.prepare('SELECT * FROM pending_mutations').all()).toEqual([]);
  });

  it('wipes only the signed-out account, including conflicted edits, across restarts', async () => {
    seed('a');
    seed('conflict', 'conflict');
    seed('b', 'pending', 'bob');
    const queue = openQueue();
    await queue.wipeUserMutations('alice');
    expect(durable.native.prepare('SELECT user_id FROM pending_mutations').all()).toEqual([
      { user_id: 'bob' },
    ]);
    expect(await openQueue().pendingMutations('alice')).toEqual([]);
    expect((await openQueue().pendingMutations('bob')).map((row) => row.id)).toEqual(['b']);
  });

  it('keeps duplicate enqueue idempotent and persists conflict/completion transitions', async () => {
    const queue = openQueue();
    await queue.enqueueMutation(mutation('a'));
    await queue.enqueueMutation({ ...mutation('a'), body: { corrupted: true } });
    expect(await queue.pendingMutations('alice')).toEqual([mutation('a')]);
    await queue.conflictMutation('a', 'Conflict');
    expect(await openQueue().pendingMutations('alice')).toEqual([]);
    await queue.completeMutation('a');
    expect(durable.native.prepare('SELECT * FROM pending_mutations').all()).toEqual([]);
  });
});

// Preferences are latest-value edits rather than FIFO commands. Migration and
// acknowledgement share the durable database but keep their own generation.
describe('durable preference edits', () => {
  let directory: string;
  let durable: ReturnType<typeof sqlite>;
  let legacy: ReturnType<typeof sqlite>;
  const values = {
    units: 'metric',
    temperatureUnit: 'celsius',
    theme: 'dark',
    defaultSpeed: 3.2,
    acceptableStartMinutes: 300,
    acceptableEndMinutes: 1320,
  } as const;
  const queue = () =>
    createMutationQueue(
      async () => durable.adapter,
      async () => legacy.adapter,
    );
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'runcast-prefs-'));
    durable = sqlite(join(directory, 'durable.db'));
    legacy = sqlite(join(directory, 'cache.db'));
    legacy.native.exec(
      'CREATE TABLE pending_mutations (id TEXT PRIMARY KEY); CREATE TABLE cache_entries(user_id TEXT,kind TEXT,cache_key TEXT,body TEXT)',
    );
  });
  afterEach(() => {
    durable.native.close();
    legacy.native.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it('migrates both historical preference shapes after the earlier command migration already ran', async () => {
    await queue().pendingMutations('alice');
    durable.native.exec("DELETE FROM queue_migrations WHERE id='preferences-cache-v1'");
    const insert = legacy.native.prepare(
      "INSERT INTO cache_entries VALUES (?, 'pending-preferences','current',?)",
    );
    insert.run('alice', JSON.stringify({ values, version: 7 }));
    insert.run('bob', JSON.stringify(values));
    expect(await queue().readPendingPreferences('alice')).toMatchObject({
      values,
      version: 7,
      editId: 'migrated:alice',
    });
    expect(await queue().readPendingPreferences('bob')).toMatchObject({ values, version: null });
    expect(legacy.native.prepare('SELECT * FROM cache_entries').all()).toEqual([]);
  });
  it('does not clear an edit saved while an earlier request is in flight', async () => {
    const store = queue();
    await store.replacePendingPreferences('alice', { values, version: 7, editId: 'first' });
    await store.replacePendingPreferences('alice', {
      values: { ...values, theme: 'light' },
      version: 7,
      editId: 'second',
    });
    expect(await store.clearPendingPreferences('alice', 'first')).toBe(false);
    expect(await queue().readPendingPreferences('alice')).toMatchObject({
      editId: 'second',
      values: { theme: 'light' },
    });
    expect(await store.clearPendingPreferences('alice', 'second')).toBe(true);
  });
  it('replays weekly windows and explicit days off after restarting and evicting response cache', async () => {
    const weeklyStartSchedule = {
      mon: [{ startMinutes: 360, endMinutes: 480 }],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    };
    await queue().replacePendingPreferences('alice', {
      values: { ...values, weeklyStartSchedule },
      version: 7,
      editId: 'schedule',
    });
    legacy.native.exec('DELETE FROM cache_entries');
    durable.native.close();
    durable = sqlite(join(directory, 'durable.db'));
    const store = queue();
    const requests: unknown[] = [];
    const scope = {
      userId: 'alice',
      isCurrent: () => true,
      assertCurrent: () => {},
      api: {
        request: async (_path: string, options: { body: string }) => {
          const body = JSON.parse(options.body);
          requests.push(body);
          return { ...body, version: 8, updatedAt: '2026-09-19T00:00:00.000Z' };
        },
      },
    } as unknown as AccountScope;
    await createPreferenceSyncCoordinator({
      read: store.readPendingPreferences,
      acknowledge: store.acknowledgePreferences,
      saveConfirmed: async () => {},
      publish: () => {},
    }).run(scope);
    expect(requests).toEqual([{ ...values, weeklyStartSchedule, version: 7 }]);
    expect(await store.readPendingPreferences('alice')).toBeNull();
  });
  it('retains preferences across cache eviction and erases only the signed-out account', async () => {
    const store = queue();
    for (const user of ['alice', 'bob'])
      await store.replacePendingPreferences(user, { values, version: 3, editId: user });
    legacy.native.exec('DELETE FROM cache_entries');
    durable.native.close();
    durable = sqlite(join(directory, 'durable.db'));
    expect(await queue().readPendingPreferences('alice')).toMatchObject({ version: 3 });
    await queue().wipeUserMutations('alice');
    expect(await queue().readPendingPreferences('alice')).toBeNull();
    expect(await queue().readPendingPreferences('bob')).toMatchObject({ editId: 'bob' });
  });
  it('does not restore acknowledged preferences after a crash before source cleanup', async () => {
    legacy.native
      .prepare("INSERT INTO cache_entries VALUES ('alice','pending-preferences','current',?)")
      .run(JSON.stringify({ values, version: 1 }));
    legacy.native.exec(
      "CREATE TRIGGER reject_cleanup BEFORE DELETE ON cache_entries BEGIN SELECT RAISE(FAIL,'cleanup interrupted'); END;",
    );
    await expect(queue().readPendingPreferences('alice')).rejects.toThrow('cleanup interrupted');
    durable.native.exec("DELETE FROM pending_preferences WHERE user_id='alice'");
    legacy.native.exec('DROP TRIGGER reject_cleanup');
    expect(await queue().readPendingPreferences('alice')).toBeNull();
  });
  it('serializes overlapping saves and replays the newest local edit on the accepted version', async () => {
    const store = queue();
    await store.replacePendingPreferences('alice', { values, version: 7, editId: 'first' });
    let resolveFirst!: (result: unknown) => void;
    const requests: unknown[] = [];
    const request = async (_path: string, options: { body: string }) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (requests.length === 1)
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      return { ...body, version: 9, updatedAt: '2026-09-19T00:00:00.000Z' };
    };
    const scope = {
      userId: 'alice',
      isCurrent: () => true,
      assertCurrent: () => {},
      api: { request },
    } as unknown as AccountScope;
    const published: unknown[] = [];
    const worker = createPreferenceSyncCoordinator({
      read: store.readPendingPreferences,
      acknowledge: store.acknowledgePreferences,
      saveConfirmed: async () => {},
      publish: (_scope, result, complete) => {
        if (complete) published.push(result.preferences);
      },
    });
    const first = worker.run(scope);
    // Wait until the request is actually in flight, then replace its pending row.
    while (!resolveFirst) await new Promise((resolve) => setTimeout(resolve, 0));
    await store.replacePendingPreferences('alice', {
      values: { ...values, theme: 'light' },
      version: 7,
      editId: 'latest',
    });
    const overlap = worker.run(scope);
    expect(overlap).toBe(first);
    expect(requests).toHaveLength(1);
    resolveFirst({ ...values, version: 8, updatedAt: '2026-09-19T00:00:00.000Z' });
    await first;
    expect(requests).toEqual([
      { ...values, version: 7 },
      { ...values, theme: 'light', version: 8 },
    ]);
    expect(published).toEqual([
      { ...values, theme: 'light', version: 9, updatedAt: '2026-09-19T00:00:00.000Z' },
    ]);
    expect(await store.readPendingPreferences('alice')).toBeNull();
  });
  it('persists the rebased successor before restart', async () => {
    const store = queue();
    await store.replacePendingPreferences('alice', {
      values: { ...values, theme: 'light' },
      version: 7,
      editId: 'latest',
    });
    expect(await store.acknowledgePreferences('alice', 'first', 8, 7)).toBe(false);
    durable.native.close();
    durable = sqlite(join(directory, 'durable.db'));
    expect(await queue().readPendingPreferences('alice')).toMatchObject({
      version: 8,
      values: { theme: 'light' },
      editId: 'latest',
    });
    // An external conflict must not rebase or erase a distinct newer local edit.
    await queue().acknowledgePreferences('alice', 'other', null, 8);
    expect(await queue().readPendingPreferences('alice')).toMatchObject({
      version: 8,
      editId: 'latest',
    });
  });
});
