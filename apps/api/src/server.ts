import { buildApp } from './app';
import { config } from './config';
import { closeDatabase } from './db/client';
import { closeDefaultPlanningBundleService } from './planning/runtime';

const app = await buildApp();
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'graceful shutdown started');
  try {
    await app.close();
  } finally {
    try {
      const drained = await closeDefaultPlanningBundleService();
      if (!drained) app.log.warn('planning preparation shutdown deadline elapsed');
    } finally {
      await closeDatabase();
    }
  }
}

function handleSignal(signal: string): void {
  void shutdown(signal).catch((error: unknown) => {
    app.log.error(error, 'graceful shutdown failed');
    process.exitCode = 1;
  });
}

process.once('SIGTERM', () => handleSignal('SIGTERM'));
process.once('SIGINT', () => handleSignal('SIGINT'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await shutdown('startup-error');
  process.exitCode = 1;
}
