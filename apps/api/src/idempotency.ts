import { and, eq, sql } from 'drizzle-orm';
import { db } from './db/client';
import { idempotencyKeys } from './db/schema';

export type MutationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function replayIdempotent<T>(
  userId: string,
  operation: string,
  key?: string,
  database: typeof db | MutationTransaction = db,
): Promise<T | null> {
  if (!key) return null;
  const [row] = await database
    .select({ response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.operation, operation),
        eq(idempotencyKeys.key, key),
      ),
    )
    .limit(1);
  return (row?.response as T | undefined) ?? null;
}

/** Keep the mutation and its replay response in the same commit. Provider I/O belongs outside. */
export async function mutateIdempotently<T>(
  userId: string,
  operation: string,
  key: string | undefined,
  mutate: (tx: MutationTransaction) => Promise<T>,
): Promise<{ response: T; replay: boolean }> {
  return db.transaction(async (tx) => {
    if (key) {
      // JSON preserves tuple boundaries; a hash collision only adds harmless serialization.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, operation, key])}, 72736179))`,
      );
      const response = await replayIdempotent<T>(userId, operation, key, tx);
      if (response !== null) return { response, replay: true };
    }
    const response = await mutate(tx);
    if (key) {
      await tx.insert(idempotencyKeys).values({ userId, operation, key, response });
    }
    return { response, replay: false };
  });
}
