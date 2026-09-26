import type { SQLiteDatabase } from 'expo-sqlite';
import {
  normalizePendingPreferences,
  type PendingPreferences,
  type PreferenceValues,
} from './preferences';

export type PendingPreferenceEdit = PendingPreferences & { editId: string };

export interface PendingMutation {
  id: string;
  userId: string;
  method: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
}

type MutationRow = {
  id: string;
  user_id: string;
  method: string;
  path: string;
  body: string | null;
  idempotency_key: string;
  state: string;
  error: string | null;
  created_at: number;
};

/** Durable account-scoped edits, independent of evictable response caches. */
export function createMutationQueue(
  open: () => Promise<SQLiteDatabase>,
  legacyDatabase: () => Promise<SQLiteDatabase>,
) {
  let opening: Promise<SQLiteDatabase> | undefined;
  const database = () => {
    opening ??= (async () => {
      const db = await open();
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
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
        CREATE TABLE IF NOT EXISTS pending_preferences (
          user_id TEXT PRIMARY KEY, edit_id TEXT NOT NULL, body TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queue_migrations (id TEXT PRIMARY KEY);
      `);
      const legacy = await legacyDatabase();
      // The private connection is not exposed until initialization resolves, so
      // no queue operation can join this transaction. This also supports web.
      await db.withTransactionAsync(async () => {
        const transaction = db;
        const migrated = await transaction.getFirstAsync(
          "SELECT id FROM queue_migrations WHERE id = 'cache-v1'",
        );
        if (migrated) return;
        const rows = await legacy.getAllAsync<MutationRow>('SELECT * FROM pending_mutations');
        for (const row of rows) {
          await transaction.runAsync(
            `INSERT OR IGNORE INTO pending_mutations
              (id, user_id, method, path, body, idempotency_key, state, error, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            row.id,
            row.user_id,
            row.method,
            row.path,
            row.body,
            row.idempotency_key,
            row.state,
            row.error,
            row.created_at,
          );
        }
        // Commit the import and marker together. A crash before legacy cleanup
        // must never resurrect an edit already completed in the durable store.
        await transaction.runAsync("INSERT INTO queue_migrations (id) VALUES ('cache-v1')");
      });
      await legacy.runAsync('DELETE FROM pending_mutations');
      await db.withTransactionAsync(async () => {
        if (
          await db.getFirstAsync(
            "SELECT id FROM queue_migrations WHERE id = 'preferences-cache-v1'",
          )
        )
          return;
        const rows = await legacy.getAllAsync<{ user_id: string; body: string }>(
          "SELECT user_id, body FROM cache_entries WHERE kind = 'pending-preferences' AND cache_key = 'current'",
        );
        for (const row of rows)
          await db.runAsync(
            'INSERT OR IGNORE INTO pending_preferences(user_id, edit_id, body) VALUES (?, ?, ?)',
            row.user_id,
            `migrated:${row.user_id}`,
            row.body,
          );
        await db.runAsync("INSERT INTO queue_migrations(id) VALUES ('preferences-cache-v1')");
      });
      await legacy.runAsync(
        "DELETE FROM cache_entries WHERE kind = 'pending-preferences' AND cache_key = 'current'",
      );
      return db;
    })().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  };

  return {
    async readPendingPreferences(userId: string): Promise<PendingPreferenceEdit | null> {
      const db = await database();
      const row = await db.getFirstAsync<{ body: string; edit_id: string }>(
        'SELECT body, edit_id FROM pending_preferences WHERE user_id=?',
        userId,
      );
      return row
        ? {
            ...normalizePendingPreferences(
              JSON.parse(row.body) as PendingPreferences | PreferenceValues,
            ),
            editId: row.edit_id,
          }
        : null;
    },
    async replacePendingPreferences(userId: string, edit: PendingPreferenceEdit): Promise<void> {
      const db = await database();
      await db.runAsync(
        'INSERT INTO pending_preferences(user_id,edit_id,body) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET edit_id=excluded.edit_id, body=excluded.body',
        userId,
        edit.editId,
        JSON.stringify({ values: edit.values, version: edit.version }),
      );
    },
    async clearPendingPreferences(userId: string, editId: string): Promise<boolean> {
      const db = await database();
      const result = await db.runAsync(
        'DELETE FROM pending_preferences WHERE user_id=? AND edit_id=?',
        userId,
        editId,
      );
      return result.changes > 0;
    },
    async acknowledgePreferences(
      userId: string,
      editId: string,
      acceptedVersion: number | null,
      requestedVersion: number,
    ): Promise<boolean> {
      const db = await database();
      let complete = false;
      await db.withExclusiveTransactionAsync(async (tx) => {
        const deleted = await tx.runAsync(
          'DELETE FROM pending_preferences WHERE user_id=? AND edit_id=?',
          userId,
          editId,
        );
        complete = deleted.changes > 0;
        if (!complete && acceptedVersion !== null)
          await tx.runAsync(
            "UPDATE pending_preferences SET body=json_set(body,'$.version',?) WHERE user_id=? AND (json_extract(body,'$.version')=? OR json_extract(body,'$.version') IS NULL)",
            acceptedVersion,
            userId,
            requestedVersion,
          );
      });
      return complete;
    },
    async enqueueMutation(mutation: PendingMutation): Promise<void> {
      const db = await database();
      await db.runAsync(
        `INSERT OR IGNORE INTO pending_mutations
           (id, user_id, method, path, body, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        mutation.id,
        mutation.userId,
        mutation.method,
        mutation.path,
        mutation.body === undefined ? null : JSON.stringify(mutation.body),
        mutation.idempotencyKey,
        Date.now(),
      );
    },
    async pendingMutations(userId: string): Promise<PendingMutation[]> {
      const db = await database();
      const rows = await db.getAllAsync<MutationRow>(
        `SELECT * FROM pending_mutations
         WHERE user_id = ? AND state = 'pending' ORDER BY created_at, id`,
        userId,
      );
      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        method: row.method,
        path: row.path,
        body: row.body === null ? undefined : JSON.parse(row.body),
        idempotencyKey: row.idempotency_key,
      }));
    },
    async completeMutation(id: string): Promise<void> {
      const db = await database();
      await db.runAsync('DELETE FROM pending_mutations WHERE id = ?', id);
    },
    async conflictMutation(id: string, error: string): Promise<void> {
      const db = await database();
      await db.runAsync(
        "UPDATE pending_mutations SET state = 'conflict', error = ? WHERE id = ?",
        error,
        id,
      );
    },
    async wipeUserMutations(userId: string): Promise<void> {
      const db = await database();
      await db.runAsync('DELETE FROM pending_mutations WHERE user_id = ?', userId);
      await db.runAsync('DELETE FROM pending_preferences WHERE user_id = ?', userId);
    },
  };
}
