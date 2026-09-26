import { bundleRequest, percentiles, planningHttpConfig } from './http';

const config = planningHttpConfig();
const iterations = Number.parseInt(process.env.RUNCAST_BENCH_ITERATIONS ?? '100', 10);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000) {
  throw new Error('RUNCAST_BENCH_ITERATIONS must be an integer from 1 to 10000');
}

const initial = await bundleRequest(config);
if (initial.response.status !== 200) {
  throw new Error(
    `Expected a cached 200 bundle before measurement; received ${initial.response.status}`,
  );
}
const etag = initial.response.headers.get('etag');
if (!etag) throw new Error('Cached bundle response did not include an ETag');

for (let index = 0; index < 10; index += 1) {
  const warmup = await bundleRequest(config, etag);
  if (warmup.response.status !== 304) {
    throw new Error(`Expected warmup 304; received ${warmup.response.status}`);
  }
}

const samples: number[] = [];
let notModified = 0;
for (let index = 0; index < iterations; index += 1) {
  const measured = await bundleRequest(config, etag);
  if (measured.response.status === 304) notModified += 1;
  else throw new Error(`Expected measured 304; received ${measured.response.status}`);
  samples.push(measured.elapsedMs);
}

process.stdout.write(
  `${JSON.stringify(
    {
      diagnosticOnly: true,
      measuredAt: new Date().toISOString(),
      path: 'authenticated deployed HTTP GET with cached artifact and If-None-Match',
      iterations,
      unit: 'ms',
      ...percentiles(samples),
      etag304Rate: notModified / iterations,
      initial200Ms: initial.elapsedMs,
      endpointOrigin: new URL(config.baseUrl).origin,
    },
    null,
    2,
  )}\n`,
);
