import { performance } from 'node:perf_hooks';
import { bundleRequest, planningHttpConfig } from './http';

if (process.env.RUNCAST_BENCH_ALLOW_PROVIDER !== '1') {
  throw new Error(
    'Set RUNCAST_BENCH_ALLOW_PROVIDER=1 only for a benchmark route with no valid artifact; this command calls the configured provider.',
  );
}

const config = planningHttpConfig();
const timeoutMs = Number.parseInt(process.env.RUNCAST_BENCH_TIMEOUT_MS ?? '120000', 10);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
  throw new Error('RUNCAST_BENCH_TIMEOUT_MS must be between 1000 and 600000');
}

const started = performance.now();
const first = await bundleRequest(config);
if (first.response.status === 200) {
  throw new Error(
    'Route already had a valid cached artifact; provider preparation was not measured',
  );
}
if (first.response.status !== 202) {
  throw new Error(`Expected initial 202 preparation response; received ${first.response.status}`);
}

const statuses = [first.response.status];
let readyResponseMs: number | null = null;
while (performance.now() - started < timeoutMs) {
  const retrySeconds = Number.parseInt(first.response.headers.get('retry-after') ?? '5', 10);
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(Math.max(retrySeconds, 1), 30) * 1000),
  );
  const polled = await bundleRequest(config);
  statuses.push(polled.response.status);
  if (polled.response.status === 200) {
    readyResponseMs = polled.elapsedMs;
    break;
  }
  if (polled.response.status !== 202) {
    throw new Error(`Preparation ended with HTTP ${polled.response.status}`);
  }
}
if (readyResponseMs === null) throw new Error(`Preparation exceeded ${timeoutMs} ms`);

process.stdout.write(
  `${JSON.stringify(
    {
      diagnosticOnly: true,
      measuredAt: new Date().toISOString(),
      path: 'client-observed deployed HTTP preparation from 202 to 200',
      elapsedToReadyMs: performance.now() - started,
      readyResponseMs,
      statuses,
      endpointOrigin: new URL(config.baseUrl).origin,
      note: 'Server forecast.v2-prepared logs provide provider-only latency.',
    },
    null,
    2,
  )}\n`,
);
