# Production architecture

This document describes the system deployed today. The design history
for the seven algorithm improvements—including the client/server
boundary, planning artifacts, latency budgets, and migration—is documented in
the [client/server planning system design](algorithm-improvements/08-client-server-system-design.md).

```mermaid
flowchart LR
  Guest[Guest iOS planner] --> Core[@runcast/core]
  Mobile[Authenticated iOS app] -->|/v1 JWT + rotating refresh| API[Fastify API]
  API --> DB[(Render PostgreSQL)]
  API --> Apple[Apple identity + revocation]
  API --> Strava[Strava identity + routes]
  API --> Canopy[USDA Tree Canopy Cover]
  Cron[15-minute cron] --> DB
  Cron --> Weather[Open-Meteo]
  Cron --> Canopy
  Cron --> Core
  Cron --> Expo[Expo Push]
  Expo --> Mobile
  Web[Guest web client] --> Core
```

`@runcast/core` owns route parsing and recommendation math. `@runcast/contracts` owns the strict versioned JSON boundaries, including the current reader-3 planning bundle and historical V2 snapshot schemas. V3 carries geometry-bound USDA Science TCC v2025.6 canopy and uncertainty profiles plus open-sky and canopy-adjusted radiation doses. The API resolves Strava and Apple identities to a provider-neutral Runcast UUID that solely owns routes, preferences, watches, sessions, and devices. Provider identities are unique and linkable but are never merged automatically. The API also performs provider-token encryption, persistence, weather and canopy caching, recommendation scheduling, and push delivery. Mobile keeps Runcast credentials in SecureStore and disposable responses in cache-directory SQLite. Pending edits live in separate durable SQLite under iOS Application Support (excluded from backups) or Android noBackupFilesDir; the route library retains its own durable database.

Strava OAuth state is hashed, single-use, and valid for ten minutes. A successful sign-in callback places only a five-minute, hashed, device-bound, single-use exchange code in the Runcast deep link; access and refresh tokens are returned by the subsequent HTTPS exchange.

No guest GPX is uploaded automatically. Guest routes fetch their categorical OpenStreetMap woodland evidence directly on device and never enter the USDA pipeline. Saving a route is a distinct authenticated action; only then may the API sample coordinates against USDA and persist the numeric profile in `route_canopy_profiles`. Canopy acquisition is lease-protected and never blocks weather planning: cached evidence is used when available, while missing/unsupported evidence stays explicitly unknown and receives open-sky radiation. PostgreSQL does not use PostGIS because every route lookup is owner/identifier based.

The server evaluates and publishes current V3 recommendations only. `CANOPY_MODEL_MODE=off|active` controls canopy weighting; both modes require reader 3. Reader 2 and the retired `/v1/routes/:id/bundle` endpoint return `426 CLIENT_UPDATE_REQUIRED`. `GET /v2/routes/:id` returns an owner-scoped descriptor containing summary, timezone, the same hashed route section used by the planning bundle, and conservative woodland evidence. It does not fetch or wait for weather, so routes remain usable during provider outages. The notification payload stays unchanged, including its historical `planning-v2` engine tag.

Mobile and web derive maps, condition strips, splits, playback, and recommendations from the current planning profile. Shared pure geometry, transforms, and display helpers live in core; rendering stays in each app. Stored legacy route DTOs and V2 evaluation/bundle readers remain isolated persistence boundaries. Their presence does not enable legacy evaluation or reader-2 bundle generation.

## API planning ownership

The HTTP endpoint and watch scheduler share planning policy and persistence. Production wiring is
separate so an in-memory repository can exercise planning without importing PostgreSQL or parsing
deployment configuration.

| Responsibility                                                            | Module                              |
| ------------------------------------------------------------------------- | ----------------------------------- |
| Reader compatibility, forecast freshness, preparation coordination, ETags | `apps/api/src/planning/service.ts`  |
| Canopy preparation, retry policy, unknown-evidence fallback               | `apps/api/src/planning/canopy.ts`   |
| Prepared forecast mapping, route identity, and strict V3 bundle assembly  | `apps/api/src/planning/bundle.ts`   |
| Owner-scoped reads, stored-schema validation, forecast and canopy leases  | `apps/api/src/planning/postgres.ts` |
| Provider preparers, configured default service                            | `apps/api/src/planning/runtime.ts`  |
| HTTP bundle response mapping                                              | `apps/api/src/routes/planning.ts`   |
| Watch occurrence evaluation and publication orchestration                 | `apps/api/src/jobs/scheduler.ts`    |

`service.ts`, `canopy.ts`, and `bundle.ts` must load without `config`, `db/client`, Drizzle, or
the PostgreSQL driver, including through transitive imports. The existing repository and preparer
interfaces have production and in-memory implementations; no additional service abstraction is
needed. Canopy policy still uses the pure region classifier in `providers/usdaCanopy.ts`; provider
requests are made by the injected preparer.

`npm run architecture:check` enforces this runtime import boundary and the existing domain naming
rules, rejects imports of retired evaluator functions and modules, and rejects retired rollout flags in runtime source. Versioned historical DTO imports from contracts remain valid. The boundary test is `apps/api/src/planning/boundaries.test.ts`. Enforcement blocks all
violations in this planning slice; other API modules are not yet subject to this rule. CI and the
opt-in `.githooks/pre-commit` hook invoke the same command. Service and canopy tests cover cache
refresh, concurrent preparation, failures, compatibility responses, and conservative canopy
fallbacks; PostgreSQL integration tests exercise forecast leases and scheduler behavior.

## Mutation and scheduler recovery

GPX/Strava imports, route renames, and watch updates use `idempotency.ts` to commit the mutation
and its replay response in one transaction. An advisory transaction lock scoped to user, operation,
and key serializes matching requests; replay is checked after acquiring the lock. Reusing a key
returns the original response, including after later edits. Route and watch updates check the
expected version in SQL. Imports serialize geometry deduplication per owner, and provider geometry
replacement preserves the route ID and increments its version. Strava fetching and GPX parsing
happen before the transaction. Watch creation retains its atomic per-user limit and replay checks.

`planning/evaluations.ts` commits a notification publication and delivery intents for the owner's
currently enabled devices together. `notifications/outbox.ts` drains those durable intents at the
start of each scheduler run and after a new publication. A reserved PostgreSQL connection holds a
session advisory lock for the scheduler pass; provider calls do not hold a database transaction
open. A crash after publication commit leaves intents for the next run. No separate queue service
is required. Historical publications without delivery intents are not automatically backfilled.

Delivery retries, individual evaluations, and receipt reconciliation have separate failure handling.
Receipt reconciliation runs after evaluation and delivery, so its provider outage cannot prevent
that pass's recommendations. Publication eligibility and every send use a fresh clock reading;
expired intents become terminal instead of sending after the recommended start. Expo acceptance
followed by failure to persist the ticket remains an at-least-once delivery window: retry can send
a duplicate because Expo provides no idempotency key.

Forecast and canopy coordinators own their pending work through `planning/preparationTasks.ts`,
including lease acquisition/release failures and awaited cache reads. Closing stops new work and
allows up to ten seconds to finish, then aborts provider requests and discards late results. Leases
abandoned at that deadline expire naturally. API shutdown and the scheduler close their coordinators
before the database closes; shutdown timeout is reported rather than silently losing detached work.

Existing strict watch result shapes remain unchanged. `notifiedAt` now records the earliest stored
Expo acceptance time and stays null when a publication has no accepted delivery. The separate,
owner-authenticated `GET /v1/watches/:id/results/:evaluationId/notification` endpoint exposes
`publishedAt`, `providerAcceptedAt`, `receiptReceivedAt`, and accepted, receipt-success,
receipt-failure, receipt-unavailable, cancelled, pending, expired, and failed delivery counts. A successful receipt is provider
confirmation, not evidence that the runner saw the notification.

The scheduler heartbeat includes evaluation and phase failures, per-pass delivery outcomes, and
persisted backlog metrics. `/health/cron` reports `degraded` with HTTP 503 for those failures or a
pending backlog older than thirty minutes, even when the heartbeat is fresh. Missing or old
heartbeats report `stale`. See the [operations runbook](operations.md) for deployment and triage.

## Durable edits, cancellation, and storage lifecycle

`apps/mobile/src/data/mutationQueue.ts` owns queued edits independently of response caches.
Initialization imports legacy pending and conflict rows with a durable migration marker in one
transaction before clearing the legacy table. Restart cannot reimport completed edits after a
partial cleanup; account cleanup removes both pending and conflict rows. The local
`modules/mutation-storage` Expo module establishes backup exclusion before SQLite opens.

Disabling a watch cancels pending and retryable delivery rows in the same transaction. Publication
enqueue locks that watch row, and each send reloads watch, device, and delivery state. Re-enabling
a watch does not revive cancelled intents. Already in-flight accepted pushes remain recorded as
accepted; an in-flight failure cannot overwrite cancellation.

`notifications/receipts.ts` owns receipt reconciliation. Each pass handles at most 500 due checks
and 500 expired records. Retry times commit before provider I/O, with 15/30/60-minute backoff, so
missing receipts or an outage cannot repeatedly monopolize the oldest batch. After 24 hours,
unknown receipts become terminal `unavailable`; this never triggers a resend or claims failure.

New evaluations reference immutable, route-scoped, content-hashed planning bundle rows rather
than copying the same bundle. Readers join new references and old inline snapshots in one database statement, so concurrent retention cannot remove an artifact between separate reads.
`planning/evaluationStorage.ts` prunes up to 500 old unpublished evaluations and 500 unreferenced
artifacts per scheduler pass. Default retention is 30 days with a seven-day minimum; both evaluation
and occurrence window must be older than the cutoff. Published evaluations and referenced ancestors
stay intact. Watch predecessor chains are occurrence-scoped, allowing expired unpublished chains
to be collected leaf-first. This bounds reclaimable history, not retained publication history.

## Cleanup assessment — September 2026

The repository already has useful package boundaries: portable calculation in core, wire schemas
in contracts, and separate deployable apps. The recent nine-commit history concentrates changes
in planning, route watches, and mobile state. Keep that monorepo shape and prioritize these seams:

1. **Planning infrastructure coupling — high leverage, completed.** `planning/service.ts` and
   `planning/canopy.ts` mixed policy with SQL and production dependencies. Moving existing adapters
   into `postgres.ts` and `runtime.ts` makes changes to persistence independent of policy imports.
   The existing memory repositories now provide a configuration-free test seam. The forecast
   mapper is shared by the provider adapter and fixtures instead of being duplicated. Eight
   unused aliases in the private API module were removed. Current-only retirement also removes
   obsolete public runtime aliases; historical serialized shapes and stored identities remain intact.
2. **Mobile planner state ownership — high leverage, deferred.** `apps/mobile/src/state.ts`
   combines preference hydration, route-library mutations, request cancellation, forecast caches,
   evaluation, and alert presentation. Start by moving route-library state transitions behind one
   reducer, with tests for hydration racing with imports, renames, and deletion. Preserve the
   existing `usePlanner` interface. This needs lifecycle tests before changing effect ordering;
   splitting the file mechanically would leave ownership unclear.
3. **Watch occurrence recovery — completed; further orchestration separation deferred.**
   Publications and device intents now commit together; delivery draining, acceptance/receipt
   outcomes, and preparation lifecycle have explicit owners. PostgreSQL tests exercise rollback,
   replay, concurrent mutation, and delivery recovery. `apps/api/src/jobs/scheduler.ts` still owns
   input preparation and revision decisions. Legacy scheduling and canopy shadow evaluation are
   retired. Migration 0014 cancels unsent legacy intents, and recorded legacy acceptance suppresses
   a duplicate initial publication for that watch occurrence. Watch revision controls remain separate.
4. **Contract-file splitting — low leverage, deferred.** `packages/contracts/src/index.ts` is
   large, but its schemas already have one owner and strict contract tests. Splitting it by domain
   would mostly move code without reducing consumer coupling. Revisit when changes demonstrate
   conflicting ownership rather than adding another layer now.

Vocabulary follows [the domain glossary](naming-and-domain-glossary.md): a prepared route forecast
is normalized input, a planning bundle is its serialized delivery artifact, and a recommendation
is an evaluated decision. Those concepts should not share a generic “artifact” interface.
