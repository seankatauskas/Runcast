import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

export const sql = postgres(config.databaseUrl, {
  max: config.nodeEnv === 'test' ? 2 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(sql, { schema });

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
