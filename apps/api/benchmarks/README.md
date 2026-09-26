# Current planning operational diagnostic harnesses

These commands are opt-in diagnostics, not CI thresholds. Run them with Node 22
from the repository root. Do not point the scheduler command at production.

## Cached bundle API and ETag/304

The route must already have a valid artifact for the authenticated user.

```sh
RUNCAST_BENCH_BASE_URL=https://staging.example \
RUNCAST_BENCH_ACCESS_TOKEN=... \
RUNCAST_BENCH_ROUTE_ID=... \
npx tsx apps/api/benchmarks/cached-bundle-api.ts
```

This measures deployed HTTP round trips. It first requires `200` plus an ETag,
then measures only matching `304` responses and reports their observed rate.

## Provider preparation

Use a dedicated route with no valid forecast artifact. The explicit guard is
required because this invokes the configured provider.

```sh
RUNCAST_BENCH_ALLOW_PROVIDER=1 \
RUNCAST_BENCH_BASE_URL=https://staging.example \
RUNCAST_BENCH_ACCESS_TOKEN=... \
RUNCAST_BENCH_ROUTE_ID=... \
npx tsx apps/api/benchmarks/provider-preparation.ts
```

This requires the first response to be `202`, polls according to `Retry-After`,
and records client-observed time to `200`. Use the server's
`forecast.v2-prepared` log for provider-only latency.

## Scheduler batch

Use a disposable, fully migrated test database. The database should contain the
intended benchmark watches and no device installations or outstanding Expo
receipts. The command rejects any device or delivery row before starting. Current evaluation,
publication, retention, and heartbeat writes remain enabled.

```sh
RUNCAST_BENCH_ALLOW_SCHEDULER=1 \
NODE_ENV=test \
DATABASE_URL=postgres://... \
npx tsx apps/api/benchmarks/scheduler-batch.ts
```

The result includes elapsed batch time, advisory-lock acquisition, and evaluated
occurrence count. Production structured logs retain per-evaluation latency,
status, IDs, bundle bytes, and scheduler lateness.
