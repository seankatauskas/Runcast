import { randomUUID } from 'node:crypto';
import { closeDatabase } from './db/client';
import { runScheduler } from './jobs/scheduler';
import { logOperationalEvent } from './observability';

const jobId = randomUUID();
const startedAt = Date.now();
try {
  const result = await runScheduler();
  logOperationalEvent('info', 'cron.complete', {
    jobId,
    durationMs: Date.now() - startedAt,
    ...result,
  });
} catch (error) {
  logOperationalEvent('error', 'cron.failed', {
    jobId,
    durationMs: Date.now() - startedAt,
    error,
  });
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
