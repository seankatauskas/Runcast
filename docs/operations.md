# Operations runbook

## Deploy and observe

Render applies `render.yaml`. Both API services run migrations as a pre-deploy command and expose `/health/ready`. Cron services use the same precompiled image with `node apps/api/dist/cron.js`, run every 15 minutes UTC, and hold a PostgreSQL session advisory lock on a reserved connection. Provider calls run outside database transactions. Monitor:

- `/health/ready` availability and API 5xx rate;
- `/health/cron` status and `outcomes`: `stale` means a missing heartbeat or one older than 30 minutes; `degraded` means a fresh pass reported evaluation/availability, receipt, phase, or delivery failures, expired deliveries, or pending work older than 30 minutes. Both return HTTP 503;
- `outcomes.deliveryMetrics`: pending count and oldest age, cumulative expired/accepted deliveries, and receipt successes/failures; compare these with per-pass `outcomes.deliveries` and evaluation failure counts;
- `cron.complete`, provider failure, push ticket, and receipt error logs;
- PostgreSQL connection, CPU, storage, and backup status;
- mobile crash-free sessions and release adoption after Sentry is connected.

Never log request bodies. A request ID or job ID should be enough to correlate events.

Mobile Sentry is intentionally limited to error reporting and aggregate session health. Configure `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, and `SENTRY_PROJECT` in the EAS `preview` and `production` environments, and store `SENTRY_AUTH_TOKEN` as a sensitive variable. Leave the DSN blank in local development. EAS native builds upload source maps through the `@sentry/react-native/expo` config plugin; for an EAS Update export, run `npm run sentry:upload-update-maps -w apps/mobile` against the generated `dist` directory. Confirm a release error is symbolicated before inviting external testers.

The mobile event sanitizer is a release gate: it drops default network/UI breadcrumbs and removes account identity, route names and geometry, provider payloads, request bodies, credentials, and push tokens. Tracing, profiling, replay, screenshots, view hierarchy, failed-request capture, SDK logs, and default PII must remain disabled unless the privacy notice, manifest, disclosure matrix, and explicit product decision are updated first.

Outbound provider deadlines are 15 seconds for API/weather/identity providers, 25 seconds for Overpass, and 30 seconds for Expo push. A caller abort signal remains authoritative. Transport timeouts do not clear a mobile session and mutation requests are never automatically replayed. Push delivery retries only transient transport failures, HTTP rate limits/server failures, and Expo `MessageRateExceeded` tickets, with at most three total attempts before the recommended start. Permanent ticket failures are not retried. Investigate the redacted `push.ticket-error`, `push.receipt-error`, `push.send-failed`, and provider failure events by delivery/request references.

## Notification recovery and rollout

After `0010_weekly_start_schedule.sql`, apply `0011_delivery_outcomes.sql`,
`0012_receipt_schedule.sql`, `0013_evaluation_storage.sql`, and
`0014_retire_legacy_planning.sql` through the pre-deploy migration command before deploying this code. Migration 0011 adds delivery `created_at`, `receipt_received_at`, and a pending-age
index. Existing enqueue times are approximated from `sent_at`, falling back to `updated_at`;
existing receipt times use `updated_at`. Historical timestamps therefore cannot establish exact
provider timing.

Publication and enabled-device delivery intents commit together. Cron drains pending/retryable
intents before evaluating watches and drains new publications after commit. A process crash after
commit is recoverable on the next scheduled pass; publication retries do not recreate intents.
Historical publications that already lack intents are not automatically backfilled. A publication
with no enabled devices also has no intents. Before treating either case as a backlog incident,
inspect the publication's delivery rows and relevant device registrations.

Each send rechecks the current time and reloads watch/device eligibility. Disabling a watch
transactionally cancels queued retries; re-enabling cannot revive them. Accepted in-flight sends
cannot be recalled. Cancelled intents are counted separately from failures. Expired intents stop retrying, and receipt reconciliation
runs after evaluation/delivery with independent failure reporting. For a degraded heartbeat, inspect
`phaseFailures`, evaluation counts, and per-pass delivery outcomes, then correlate
`watch.scheduler-phase-failed`, `watch.evaluation-failed`, `push.delivery-processing-failed`, and
push ticket/receipt events. Backlog counts are snapshots; accepted and receipt totals include
historical rows and are not counts for just the latest pass.

Use the authenticated `GET /v1/watches/:id/results/:evaluationId/notification` endpoint to distinguish
publication creation, provider acceptance, receipt processing, and pending/failed/expired/cancelled deliveries.
Existing watch result `notifiedAt` now means recorded provider acceptance, not publication creation;
the existing strict response shapes are preserved. A successful receipt does not prove that the
runner saw the push. If Expo accepted a push but persisting its ticket failed, a later attempt can
produce a duplicate; this remains at-least-once delivery, not exactly-once delivery.

Forecast and canopy preparation stop accepting work during shutdown and drain for up to ten
seconds before aborting provider work. API shutdown logs a timeout; scheduler shutdown records a
`preparation-shutdown` phase failure. Abandoned leases expire naturally, and late preparation
results are discarded before new persistence work starts.

GPX/Strava imports, renames, and watch updates persist mutation results and idempotency responses
in one transaction. Clients retry an interrupted operation with its original key and payload;
a new intended mutation requires a new key. A version conflict requires reading the current route
or watch before deciding on a new edit. Strava geometry replacement increments the route version.

## Database restore drill

Monthly, restore the latest production backup/PITR snapshot into a new isolated staging database. Point only the staging API at it, run `/health/ready`, count users/routes/watches without exporting coordinates, exercise one known synthetic account, then destroy the restored database. Record recovery point, start/end time, validation result, and operator. Never point a production service at the drill database.

## Rollback

- **API:** redeploy a known-good image that supports current reader 3 and artifact-backed historical evaluations. Crossing the current-only cutover requires a coordinated API, cron, and mobile rollback; simply restoring an old image can re-enable legacy sends or strand migrated mobile edits.
- **Database:** migrations use expand/migrate/contract. Do not reverse a destructive migration during an incident. Roll back application code first; restore only for verified data loss/corruption.
- **EAS Update:** republish the previous compatible update to the affected channel. Native dependency, entitlement, or config changes require a replacement binary, never an OTA update.
- **Mobile binary:** stop phased release/TestFlight distribution and select a reader-3 build with the durable mutation module. Older bundle readers are intentionally refused.

## Strava-first beta reset

Migration `0003_strava_first_auth.sql` is an explicitly approved beta reset rather than an expand/migrate/contract change. It deletes current beta users and cascading account data before introducing provider-neutral identities. Do not apply it manually to staging or production; deploy it only through the reviewed pre-deploy migration command after confirming the target environment. Testers must sign in again after installing the matching mobile update. Rolling application code back across this migration does not restore deleted beta accounts.

## Secret rotation

Rotate one provider/environment at a time. `ACCESS_TOKEN_SECRET` rotation expires access JWTs but refresh sessions recover. Rotating `CREDENTIAL_ENCRYPTION_KEY` requires a dual-read/re-encryption migration; never overwrite it directly while encrypted Apple or Strava tokens exist.

## Planner rollout and release identity

Current V3 evaluation and publication are always enabled. The retired `PLANNING_V2_*` switches and
legacy scheduling are not rollback mechanisms. Remove those variables from deployment settings.
`/health/release` reports `planner.mode=current`, `bundleReader=3`, `canopyModelMode`, and
`RELEASE_SHA` (falling back to Render's `RENDER_GIT_COMMIT`). Release verification accepts both supported
canopy modes; staging and production normally use active. `/health/cron` exposes
`schedulerRelease`, persisted by the latest completed pass; use `status` and `outcomes`, since the
historical `lastSuccessAt` field records completion even for a degraded pass.

`CANOPY_MODEL_MODE=off|active` controls numeric canopy weighting. `active` enriches route evidence
and uses conservative canopy-adjusted radiation. `off` uses current V3 open-sky evaluation and
does not start new server canopy acquisition; cached evidence remains stored. Both modes require
bundle reader 3. Canopy shadow mode is retired. Keep the corresponding mobile public canopy
setting aligned with the server for bundled demos. `WATCH_REVISION_MODE=off|shadow|active` remains
independent and controls second-publication revision policy only.

For the current-only cutover:

1. Build and distribute the matching native mobile app; the durable mutation module cannot be
   added to an older binary using an OTA update.
2. Pause the legacy cron deployment before migration 0014. Apply all migrations through the
   normal pre-deploy command, deploy the current API and cron from the same release, then resume
   scheduling. Do not run an old scheduler concurrently with the new one during cutover.
3. Verify `/health/release`, the next cron heartbeat, owner-scoped `GET /v2/routes/:id`, and reader-3
   planning bundle responses. Descriptors work without weather. Reader 2 and the old route bundle
   endpoint must return `426 CLIENT_UPDATE_REQUIRED`; clients should show the update-required flow.
4. Check cancellation counts and publication history. Migration 0014 cancels pending/retryable
   legacy intents only. Accepted legacy tickets and their receipts remain; those occurrences do
   not produce another initial notification. Already accepted pushes cannot be recalled.

Retirement changes live execution, not historical bytes: old route geometry, published evaluations,
inline/artifact snapshots, and previously delivered notification references stay readable. No
production rollout or external service changes are performed by the repository cleanup itself.

## Receipt scheduling and evaluation retention

Migration 0012 adds receipt attempts, next-check times, and a partial due-work index. Initial receipt
checks retain the existing five-minute minimum; missing receipts retry after 15, 30, then 60 minutes.
The scheduler records retry times before requests, including requests that fail. It stops checking
after 24 hours, matching [Expo receipt retention](https://docs.expo.dev/push-notifications/sending-notifications/).
`receiptUnavailable` reports newly expired records; `deliveryMetrics` exposes cumulative unavailable,
pending receipt, and cancelled delivery counts. Unavailable means delivery confirmation is unknown.
A pass that expires receipts degrades cron health; historical totals alone do not keep health degraded.

Migration 0013 keeps existing inline snapshots readable and immutable; new writes deduplicate bundles.
`EVALUATION_RETENTION_DAYS` defaults to 30 (allowed 7–3650). The separate `evaluation-retention` phase
prunes only unpublished, unreferenced, closed-window history, in bounded batches, and reports counts
under heartbeat `evaluationRetention`. Published evaluations and their referenced ancestry remain.

Measure the target database with `npm run storage:measure -w apps/api`, or
`node apps/api/dist/measureEvaluationStorage.js` in the production image. The read-only report includes
row counts, inline/artifact snapshot bytes, candidate bytes, relation size, and estimated dedup savings.
The 30-day default is an operational policy, not a production growth measurement. Inspect these
metrics and product history needs before changing retention. The integration fixture stores two
evaluations sharing one bundle in 2,513 snapshot bytes instead of 5,026; this measures only that
synthetic snapshot column, not total database size or production growth. Deleted unpublished history is not
restored by application rollback. PostgreSQL can reuse freed space; deletion does not immediately
shrink relation files. Rolling back to an older application that lacks artifact hydration can omit
snapshot-derived fields for new evaluations; retain the compatible reader during rollback.

## Durable mobile edits rollout

Mobile 0.2.1 adds the local `mutation-storage` Expo native module. Build and install a new native app;
the existing appVersion runtime policy prevents this JavaScript from being sent as an OTA update to
0.2.0. Expo Go cannot provide this module. iOS uses an Application Support directory marked
`isExcludedFromBackup`; Android uses `noBackupFilesDir`, including SQLite journals. Queued edits
survive cache eviction and process restarts, but app uninstall/device loss can still remove them.
Migration preserves mutation IDs, ordering, account ownership, conflicts, and idempotency keys.
Edits already evicted by the OS before upgrade cannot be recovered. Avoid downgrading after migration:
older clients only read the now-empty cache queue.
