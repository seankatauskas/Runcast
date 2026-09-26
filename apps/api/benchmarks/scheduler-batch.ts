import { performance } from 'node:perf_hooks';

if (process.env.RUNCAST_BENCH_ALLOW_SCHEDULER !== '1') {
  throw new Error(
    'Set RUNCAST_BENCH_ALLOW_SCHEDULER=1 only for a disposable migrated benchmark database.',
  );
}
if (process.env.NODE_ENV !== 'test') {
  throw new Error('Scheduler benchmark requires NODE_ENV=test');
}
if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required');

const { runScheduler } = await import('../src/jobs/scheduler');
const { db, closeDatabase } = await import('../src/db/client');
const { deviceInstallations, notificationDeliveries } = await import('../src/db/schema');
try {
  const [devices, deliveries] = await Promise.all([
    db.select({ id: deviceInstallations.id }).from(deviceInstallations).limit(1),
    db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).limit(1),
  ]);
  if (devices.length || deliveries.length) {
    throw new Error(
      'Scheduler benchmark requires a disposable database with no devices or delivery rows',
    );
  }
  const started = performance.now();
  const result = await runScheduler(new Date());
  process.stdout.write(
    `${JSON.stringify(
      {
        diagnosticOnly: true,
        measuredAt: new Date().toISOString(),
        path: 'one current scheduler batch against a disposable test database',
        elapsedMs: performance.now() - started,
        ...result,
        note: 'Evaluation, publication, retention, and heartbeat writes remain enabled; no delivery destinations exist.',
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await closeDatabase();
}
