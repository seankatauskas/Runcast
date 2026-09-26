import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDatabase, db } from './client';

try {
  await migrate(db, {
    migrationsFolder: resolve(import.meta.dirname, '../../migrations'),
  });
  console.log('database migrations complete');
} finally {
  await closeDatabase();
}
