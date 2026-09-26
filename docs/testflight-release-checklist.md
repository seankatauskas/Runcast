# External TestFlight release checklist

This is the go/no-go checklist for the first external Runcast TestFlight build. The release tag is
the source of truth: API, scheduler, legal site, mobile binary, and uploaded source maps must all
come from the same commit.

## One-time setup

- [ ] Sync `render.yaml` and confirm the staging API, staging scheduler, production API,
      production scheduler, databases, and `runcast-legal` static site exist.
- [ ] Disable unpinned automatic production deploys. Production deploy hooks must accept the
      release workflow's `ref=<tag commit SHA>` parameter.
- [ ] Add GitHub environment secrets for the production API, scheduler, and legal-site deploy
      hooks plus the Expo token/project ID. Keep Sentry source-map credentials in EAS, where the
      native build runs.
- [ ] Add the mobile Sentry DSN, organization, project, and auth token to the appropriate EAS
      environments. Keep the auth token build-only and never expose it through `EXPO_PUBLIC_*`.
- [ ] Set `EXPO_PUBLIC_LEGAL_BASE_URL` in EAS preview and production after the Render static-site
      URL is known.
- [ ] Configure Render alerts for failed deploys, readiness, and database health. Configure an
      external monitor for `/health/cron` with a 30-minute stale threshold.
- [ ] Confirm Apple Sign in with Apple, push credentials, App Store Connect submit credentials,
      Strava OAuth credentials/callbacks, and the Expo project are configured for the production
      bundle ID.
- [ ] Enter the reviewed privacy answers in App Store Connect from the disclosure matrix and add
      the published privacy, support, and deletion URLs.

## Staging candidate

- [ ] Merge only a green commit: formatting, naming boundaries, unit tests, TypeScript, database
      migrations/integration tests, web build, Expo public config, Expo Doctor, and the reviewed
      dependency-audit policy all pass with no new high or critical advisory.
- [ ] Deploy the candidate commit to both staging API and staging scheduler.
- [ ] Verify `/health/release` reports the candidate SHA, `planner.mode=current`, `bundleReader=3`,
      and the intended supported canopy mode. Confirm retired reader 2 receives `426`.
- [ ] Verify `/health/cron` reports a fresh scheduler heartbeat from the same candidate SHA.
- [ ] Build the EAS preview profile and confirm one deliberately captured test exception is
      symbolicated, tagged `preview`, and contains no account, route, location, token, screenshot,
      view-hierarchy, or replay data.
- [ ] Run the Maestro functional smoke suite on a clean iOS simulator.
- [ ] Complete and record every row in the physical-device matrix in `docs/mobile-e2e.md`,
      including real Files GPX import, OAuth, push permission/token lifecycle, delivery states,
      sign-out deactivation, and missing/deleted route outcomes.
- [ ] Confirm introduction replay, VoiceOver labels/order, Dynamic Type, dark/light mode, reduced
      motion, offline Route Library behavior, and terminal missing/deleted-route deep links.
- [ ] Inspect the archive privacy report against the disclosure matrix.

## Production tag

- [ ] Update the app version and confirm the tag is exactly `mobile-v<app version>`.
- [ ] Create the tag from the staging-tested commit. Do not retag a different commit.
- [ ] Confirm the release workflow deploys the tag SHA to the production API, scheduler, and legal
      site, then proves all three identities before starting EAS Build.
- [ ] Confirm the production API reports current planning, reader 3, and the expected release environment.
- [ ] Confirm the EAS production build uploads source maps and submits the expected bundle ID,
      version, build number, runtime version, release SHA, API URL, and legal URL.
- [ ] Add concise TestFlight notes covering route import/library, forecasts, route watches, known
      limitations, disclaimer, support contact, and the exact scenarios testers should exercise.
- [ ] Add the external tester group only after App Store/TestFlight processing and beta review
      checks are green.

## First 24 hours

- [ ] Watch crash-free sessions, new/regressed mobile errors, API readiness/5xx, scheduler age,
      provider failures, push ticket/receipt failures, database health, and release adoption.
- [ ] Exercise a synthetic route watch and verify its delivery, tap acknowledgement, and deep link.
- [ ] Record the release SHA, EAS build ID, App Store build number, Render deploy IDs, migration
      version, V2 flags, legal URL, smoke result, and operator in the release record.

## Rollback triggers

Stop distribution for a crash loop, account/session loss, route data loss or resurrection,
incorrect destructive sync, widespread unusable forecasts, notification leakage/misdirection, or a
privacy/configuration mismatch. Roll back application code before attempting any database restore;
do not reverse an expand-only migration during an incident.
