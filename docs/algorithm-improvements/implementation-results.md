# Current algorithm and system-slice implementation results

## Status and interpretation

This document records verification and diagnostic measurements for the restrained
Algorithms 1–7 and Plan 8 vertical slice. It distinguishes code-path proof from
runtime or operational evidence. The benchmark is diagnostic: it does not set a
generic CI wall-clock threshold, and its numbers should not be generalized to
other hosts or mobile devices.

Measured benchmark results below were produced from integration commit
`2313a54`, which contains the versioned diagnostic runner. Final repository and
simulator verification was completed at `eb8d4b3`. The benchmark command was:

```sh
npx tsx packages/core/benchmarks/v2-diagnostics.ts
```

## Designated-host diagnostic results

Measured at `2026-07-19T04:32:51.077Z` on:

- Node.js `v22.23.1`
- macOS/Darwin `25.2.0`, x64
- Intel Core i7-1068NG7 at 2.30 GHz, 8 logical CPUs

The deterministic fixture uses a 9,937.10 m route with 101 source points,
complete elevation, the bounded 201-point timing mesh, two weather anchors with
72 hourly values, and a 24-hour start window containing 49 candidates. The
serialized planning bundle is 42,251 UTF-8 bytes.

| Diagnostic code path                           | Iterations | p50 (ms) | p95 (ms) | p99 (ms) |
| ---------------------------------------------- | ---------: | -------: | -------: | -------: |
| One cached V2 plan evaluation                  |        400 |    1.791 |    2.838 |    3.294 |
| Full 24-hour/49-candidate recommendation scan  |         50 |   89.985 |  113.372 |  125.986 |
| Bundle parse, hash check, and memory promotion |        200 |    5.059 |    6.267 |    6.916 |

The first two rows execute the production `evaluateRunV2` and
`recommendStartV2` functions. The bundle row executes the production mobile
schema parser and all nested SHA-256 identity checks, followed by promotion to
an in-memory implementation of the one-row store interface. It does **not**
measure Expo SQLite, filesystem behavior, bridge overhead, or an actual device.

A later diagnostic rerun after consumer integration (`32debbc`) remained in
the same range: 1.848/2.728/3.337 ms for one cached plan,
92.586/122.487/127.118 ms for the 49-candidate scan, and
5.191/6.631/7.432 ms for bundle parse, hash check, and memory promotion
(p50/p95/p99 respectively). The iOS packaging-only change in `eb8d4b3` does not
alter these code paths.

## Cross-runtime decision proof

The frozen cross-runtime golden exercises the same pure weather normalizer,
run evaluator, and recommendation ranker through three supported import
surfaces: the public Node package entry, browser-compatible leaf ESM modules,
and the public TypeScript entry used by Metro/Hermes. It asserts identical:

- candidate timestamps;
- recommendation status and structured reason codes;
- winner timestamp and deterministic evaluation identity;
- missing-required-input abstention;
- thunderstorm hard blocking without preference compensation.

Numeric comparisons document tolerances of `1e-10` for conditions fit, `1e-6`
seconds for duration, and `1e-3 J/m²` for radiation dose. The current V8 run was
also byte-identical at the evaluation identity.

This is not a claim of execution in three engines. The actual test process was
Node/V8. The web application was compiled and bundled with Vite, but no browser
automation ran the golden. The Hermes-compatible entry contains no Node or DOM
dependencies. The iOS smoke flow rendered the application in Hermes, but did
not execute this frozen golden harness or compare its numeric output.

## Verification completed for this slice

Final verification on the integration branch produced:

| Check                                             | Result                                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| Root `npm test`                                   | 42 files, 278 tests passed across all five workspaces    |
| Root `npm run typecheck`                          | Passed                                                   |
| Root `npm run build`                              | Passed                                                   |
| Root `npm run format:check`                       | Passed                                                   |
| Fresh PostgreSQL migrations and API integration   | Migrations 0001–0004; 19/19 tests passed                 |
| Upgrade PostgreSQL migrations and API integration | Existing 0001–0003 upgraded through 0004; 19/19 passed   |
| Expo SDK 57 Doctor                                | 18/20 checks passed; dependency patch drift remains      |
| iOS source-mode native build                      | Passed on iPhone 17 Pro simulator with iOS 26.5          |
| iOS Metro/Hermes launch and render                | Passed; guest demo planner rendered and remained running |
| Notification-style route deep link                | Passed for `runcast://routes/lakefront?evaluation=...`   |

The 278 workspace tests comprise 217 core tests, 8 contracts tests, 18 API unit
tests, 33 mobile tests, and 2 web tests. The 19 database integration tests were
also run separately against both fresh and upgraded PostgreSQL schemas. The web
production build reports the existing Vite chunk-size warning above 500 kB.

Expo Doctor's two remaining findings concern duplicate installed Expo modules
and patch-level drift for `expo`, `expo-constants`, `expo-dev-client`,
`expo-notifications`, and `expo-router`. npm retained the older workspace-local
dependency graph during an attempted alignment, so this broader dependency
cleanup was not folded into the native packaging fix.

The initial simulator build failed at startup because `React.framework`
referenced a missing `ReactNativeDependencies.framework`. Enabling Expo's
source-build property for React Native, regenerating CocoaPods, and performing a
clean Xcode build removed that mixed linkage. The rebuilt app then launched,
rendered the planner through Metro/Hermes, and handled the route deep link.

The web guest planner now parses GPX with the bounded V2 parser, normalizes
direct Open-Meteo data with the shared pure normalizer, evaluates and ranks with
the V2 pipeline, and uses a shared pure OSM multipolygon normalizer for uploaded
route evidence. The legacy plan remains an explicit presentation adapter only.
If any legacy-required provider series contains a null or non-finite value, the
adapter returns no legacy display plan; it never converts missingness to zero or
NaN display output.

The UI presents `recommended`, `caution`, `no-suitable-window`, and
`unavailable`, together with structured reasons. Conditions are labeled
`favorable`, `mixed`, or `challenging`, with factor explanations and timing
quality. The copy describes expected flat pace for this run and does not present
conditions fit as medical safety or a calibrated physiological score.

## Operational and runtime evidence not measured

No value is reported for the following because the relevant environment or
traffic was not exercised in this diagnostic run:

- Open-Meteo or Overpass provider latency and failure rate;
- cached planning-bundle API latency;
- ETag/`304 Not Modified` rate;
- preparation lease recovery or provider-preparation latency;
- scheduler batch latency, lateness, or status distribution;
- evaluation, publication, and delivery throughput;
- PostgreSQL persistence latency;
- Expo SQLite parse/hash/install latency;
- timed iOS simulator latency;
- physical mobile-device latency;
- browser-engine golden execution;
- Hermes-engine golden execution;

The simulator smoke proved native startup, Metro/Hermes rendering of the guest
demo planner, and route deep-link navigation. It did not record latency
percentiles or manually exercise the system document picker, authenticated
bundle sync, offline reopen, caution, or no-suitable-window scenarios. Those
states are covered by automated core/mobile fixtures but remain unmeasured as
end-to-end simulator interactions.

The absence of physical-device measurements means the Plan 8 mobile latency
budget is unverified. Simulator results, if collected later, must remain labeled
as simulator results rather than device latency.

## Runnable operational diagnostics

Three additional opt-in harnesses are versioned under `apps/api/benchmarks`:

```sh
# Authenticated deployed HTTP 200 + matching ETag/304 percentiles
RUNCAST_BENCH_BASE_URL=https://staging.example \
RUNCAST_BENCH_ACCESS_TOKEN=... \
RUNCAST_BENCH_ROUTE_ID=... \
npx tsx apps/api/benchmarks/cached-bundle-api.ts

# Client-observed provider preparation from initial 202 to ready 200
RUNCAST_BENCH_ALLOW_PROVIDER=1 \
RUNCAST_BENCH_BASE_URL=https://staging.example \
RUNCAST_BENCH_ACCESS_TOKEN=... \
RUNCAST_BENCH_ROUTE_ID=... \
npx tsx apps/api/benchmarks/provider-preparation.ts

# One scheduler batch against a disposable migrated test database
RUNCAST_BENCH_ALLOW_SCHEDULER=1 \
NODE_ENV=test \
PLANNING_V2_EVALUATION_ENABLED=true \
PLANNING_V2_PUBLICATION_ENABLED=false \
DATABASE_URL=postgres://... \
npx tsx apps/api/benchmarks/scheduler-batch.ts
```

The API harness requires a valid cached artifact, measures deployed HTTP round
trips, and reports the observed `304` rate. The preparation harness requires a
dedicated route with no valid artifact and makes real provider calls. The
scheduler harness refuses non-test environments and enabled publication, but it
does append evaluations and update the heartbeat in the supplied database. Its
database must contain no device installations or outstanding Expo receipts.
These operational harnesses were not run for the designated-host results above,
so no operational percentile or throughput claim is made here.

## Deferred scope

The implementation and these measurements do not activate DEM enrichment,
lidar or 3D shadows, ensembles, trained or personalized models, CFD, Redis,
queues, object storage, microservices, or official-alert expansion. They also do
not establish clinical safety, physiological calibration, forecast accuracy, or
hindcast quality. Those remain separate research or rollout gates described in
the design documents.

## Reproduction and future measurement

The runner is intentionally outside generic CI thresholds. Future measurements
should retain the emitted host, fixture, iteration, bundle-size, and percentile
metadata. Provider, API, scheduler, SQLite, browser, Hermes, simulator, and
physical-device results should be appended only when those exact code paths are
executed, with the commit and hardware identified.
