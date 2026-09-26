# Runcast Deployment and Release Guide

This guide explains where each part of Runcast lives, which services run it,
which tools manage the delivery pipeline, and the remaining steps required to
turn the locally working application into a cloud-backed TestFlight beta.

## Current state

As of August 18, 2026:

- The guest planner works locally and does not require the Runcast API.
- The source repository is hosted at
  `https://github.com/seankatauskas/runcast` with `main` as the integration branch.
- GitHub Actions can run after the initial `main` snapshot is pushed and Actions are enabled.
- The API can run locally at `http://localhost:3000`.
- The configured staging API endpoint returns `404` and is not ready for use.
- `api.runcast.app` does not resolve in DNS.
- The configured legal-site endpoint is not serving its release metadata.
- Authentication, cloud routes, watches, synchronization, and remote
  notifications require a deployed API and database.

The core application is largely implemented. The remaining work is primarily
service provisioning, credentials, physical-device validation, and release
execution.

## System map

| Component                        | Source                                                              | Intended runtime                        |
| -------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| iOS application                  | [`apps/mobile`](../apps/mobile)                                     | Expo EAS, TestFlight, and the App Store |
| HTTP API                         | [`apps/api`](../apps/api)                                           | Render Docker web service               |
| Scheduled watch worker           | [`apps/api/src/cron.ts`](../apps/api/src/cron.ts)                   | Render cron job every 15 minutes        |
| PostgreSQL schema and migrations | [`apps/api/src/db`](../apps/api/src/db)                             | Render PostgreSQL                       |
| Planning engine                  | [`packages/core`](../packages/core)                                 | Shared by mobile, API, and web          |
| Versioned API contracts          | [`packages/contracts`](../packages/contracts)                       | Shared Zod `/v1` schemas                |
| Legal pages and guest web client | [`apps/web`](../apps/web)                                           | Render static site                      |
| Infrastructure definition        | [`render.yaml`](../render.yaml)                                     | Render Blueprint                        |
| Mobile build profiles            | [`apps/mobile/eas.json`](../apps/mobile/eas.json)                   | Expo EAS Build and Submit               |
| CI workflow                      | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)           | GitHub Actions                          |
| Production release workflow      | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | GitHub Actions                          |

## Environment map

| Environment       | Mobile API URL                                          | Backend                                   |
| ----------------- | ------------------------------------------------------- | ----------------------------------------- |
| Local development | `http://localhost:3000`                                 | Local Node API and Docker PostgreSQL      |
| E2E simulator     | `http://localhost:3000` with an isolated application ID | Local API or deterministic E2E seams      |
| Preview           | `https://runcast-api-staging.onrender.com`              | Render staging API, database, and cron    |
| Production        | `https://api.runcast.app`                               | Render production API, database, and cron |

`localhost` works from the iOS Simulator because it runs on the Mac. A physical
iPhone must use the Mac's reachable LAN address or, preferably, the deployed
staging API.

## Tooling and responsibilities

| Concern                      | Tooling                          | Responsibility                                                                         |
| ---------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Source control               | GitHub                           | Repository hosting, pull requests, reviews, and branch protection                      |
| Continuous integration       | GitHub Actions                   | Formatting, naming boundaries, type checks, tests, migrations, Expo checks, and audits |
| Secret scanning              | Gitleaks                         | Full-history credential detection                                                      |
| Backend packaging            | Docker                           | Reproducible Node 22 API and cron runtime                                              |
| Backend infrastructure       | Render Blueprint                 | Staging and production services, databases, cron jobs, legal site, and deploy hooks    |
| Database management          | PostgreSQL 17 and Drizzle        | Persistence, schema migrations, integration tests, and restore drills                  |
| Mobile builds                | Expo EAS Build                   | Development, E2E, preview, and production iOS binaries                                 |
| Mobile submission            | Expo EAS Submit                  | Upload to App Store Connect and TestFlight                                             |
| Compatible OTA updates       | Expo EAS Update                  | JavaScript and asset updates that do not change native dependencies or configuration   |
| Mobile E2E testing           | Maestro                          | Guest introduction, route lifecycle, forecast retry, and notification deep-link flows  |
| Unit and integration testing | Vitest                           | Core engine, contracts, API, mobile, web, and release scripts                          |
| Crash reporting              | Sentry                           | Sanitized mobile errors, release health, and symbolicated source maps                  |
| Beta and store release       | App Store Connect and TestFlight | Beta review, tester distribution, release metadata, and App Store publication          |

## Delivery flow

```text
feature branch
  -> GitHub pull request
  -> CI checks
  -> merge to main
  -> automatic Render staging deployment
  -> EAS preview build
  -> physical-device validation
  -> mobile-vX.Y.Z tag
  -> production API, cron, and legal deployments
  -> release SHA and health verification
  -> EAS production build and submission
  -> TestFlight
  -> App Store
```

Production Render services have automatic deployment disabled. The production
mobile tag workflow is the intended release authority.

## Required service accounts

Create or confirm access to the following accounts before provisioning:

- GitHub
- Render
- Expo and EAS
- Apple Developer and App Store Connect
- Strava developer platform
- Sentry
- The DNS provider for `runcast.app`

## Ordered implementation plan

### 1. Publish the source repository

- Create the GitHub repository.
- Add it as the Git remote and push `main`.
- Enable pull requests and protect `main`.
- Require the CI workflow before merge.
- Create a protected GitHub `production` environment.

Until the repository is on GitHub, neither CI nor the tag-driven release
workflow can run.

### 2. Configure Apple, Expo, and Strava

- Register the iOS bundle identifier `com.seankatauskas.runcast`.
- Configure Sign in with Apple.
- Create the APNs credentials required by Expo Push.
- Create the App Store Connect application record.
- Create or link the Expo EAS project and record its project ID.
- Configure the Strava application and its authorized callback URLs.
- Decide whether staging and production require separate Strava applications.

The intended callbacks are:

```text
https://runcast-api-staging.onrender.com/v1/integrations/strava/callback
https://api.runcast.app/v1/integrations/strava/callback
```

### 3. Provision staging with Render

- Connect the GitHub repository to Render.
- Apply [`render.yaml`](../render.yaml) as a Blueprint.
- Confirm creation of the staging API, PostgreSQL database, and cron worker.
- Add the provider secrets marked `sync: false` in the Blueprint.
- Confirm that the pre-deploy migration succeeds.
- Verify `/health/ready`, `/health/release`, and `/health/cron`.
- Deploy the legal static site and verify `/release.json`.

Render staging requires these externally supplied secrets:

- `APPLE_CLIENT_ID`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `EXPO_ACCESS_TOKEN`

Use `com.seankatauskas.runcast.preview` for the staging `APPLE_CLIENT_ID` and
`com.seankatauskas.runcast` for production. Each API environment's
`MOBILE_DEEP_LINK` must use the scheme for its installed app profile
(`runcast-preview://account` for staging and `runcast://account` for production).

Render generates the access-token and credential-encryption secrets defined by
the Blueprint. Do not replace the credential-encryption key after encrypted
provider credentials have been stored without following the rotation procedure
in the [operations runbook](operations.md).

### 4. Configure EAS environments

Use [`apps/mobile/.env.example`](../apps/mobile/.env.example) as the variable
inventory. Configure development, preview, and production separately.

Required public build configuration includes:

- `EAS_PROJECT_ID`
- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_APP_ENV`
- `EXPO_PUBLIC_LEGAL_BASE_URL`
- `EXPO_PUBLIC_SENTRY_DSN` for preview and production

Sentry source-map upload additionally requires:

- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN` stored as a sensitive EAS variable

Never enable `EXPO_PUBLIC_E2E_MODE` in a preview, production, TestFlight, or OTA
build.

### 5. Produce and validate a preview build

- Build the `preview` profile from [`apps/mobile/eas.json`](../apps/mobile/eas.json).
- Install it on a physical iPhone.
- Confirm it connects to the Render staging API.
- Trigger a controlled preview error and confirm Sentry symbolication.
- Verify that Sentry events contain no prohibited account, route, location,
  provider, credential, or push-token data.

The minimum staging journey is:

```text
guest plan
  -> Strava sign-in
  -> route import
  -> cloud save
  -> watch creation
  -> scheduled notification
  -> notification tap
  -> correct route plan
  -> offline reopen
```

Also validate Sign in with Apple, account linking, sign-out, token rotation,
route mutation recovery, notification denial, and account deletion.

### 6. Prepare production infrastructure

- Provision the production Render API, database, cron, and legal services.
- Configure production provider secrets separately from staging.
- Point `api.runcast.app` DNS at the production Render API.
- Configure the production Apple and Strava callback settings.
- Publish the privacy, support, deletion, and forecast disclaimer pages.
- Verify the production public Expo configuration.

### 7. Configure GitHub release secrets

The protected GitHub `production` environment needs:

- `EAS_PROJECT_ID`
- `EXPO_TOKEN`
- `RENDER_PRODUCTION_DEPLOY_HOOK`
- `RENDER_PRODUCTION_CRON_DEPLOY_HOOK`
- `RENDER_LEGAL_DEPLOY_HOOK`

Keep all provider credentials and signing secrets out of the repository.

### 8. Execute a tagged production release

- Complete the repository release gates.
- Update the application version.
- Commit the release version.
- Push a signed version tag such as `mobile-v0.2.0`.
- Observe the production workflow through tests, deployment, verification,
  EAS build, and App Store submission.
- Confirm the API, cron, legal site, and mobile build report the expected Git
  SHA.

### 9. Complete the external TestFlight beta

- Submit the build for Beta App Review.
- Invite at least five external testers for one week.
- Ensure every tester completes an authenticated route import and watch.
- Record at least five delivered and opened scheduled notifications.
- Review Sentry crash-free sessions, API errors, cron health, push receipts,
  provider failures, and database capacity.
- Resolve all critical and high-severity defects before release.

## Release gates

Before a production tag, run:

```sh
npm run format:check
npm run naming:check
npm run typecheck
npm test
RUN_DB_TESTS=true npm run test:integration -w apps/api
npm run build -w apps/web
npm run audit:release
```

Also require:

- Expo public configuration validation
- Expo Doctor
- Full-history secret scanning
- PostgreSQL migration verification
- Staging smoke tests
- Physical-device authentication and notification tests
- Database restore and rollback rehearsals

## Release-management rules

- Treat `main` as the staging integration branch.
- Use pull requests and required CI checks for all changes.
- Release production only from an immutable `mobile-vX.Y.Z` tag.
- Keep production Render auto-deploy disabled.
- Use database expand/migrate/contract changes; do not reverse destructive
  migrations during an incident.
- Use EAS Update only for JavaScript or asset changes compatible with the
  installed native runtime.
- Ship native dependency, entitlement, permission, or Expo configuration
  changes in a new binary.
- Record the release tag, Git SHA, EAS build number, Render deployment, database
  migration, and TestFlight build together.
- Preserve the previous compatible API deployment, mobile binary, and OTA
  update as rollback targets.

## Immediate milestone

The most useful next milestone is:

```text
GitHub repository
  -> healthy Render staging API and PostgreSQL database
  -> linked EAS project
  -> preview build on a physical iPhone
  -> successful Strava sign-in and route import
```

Completing that path proves the application works as a connected full-stack
system. Production provisioning, external TestFlight testing, and App Store
release can then follow the same validated path.

## Related documentation

- [Architecture](architecture.md)
- [Operations runbook](operations.md)
- [Release checklist](release-checklist.md)
- [TestFlight release checklist](testflight-release-checklist.md)
- [Mobile E2E guide](mobile-e2e.md)
- [Dependency audit](dependency-audit.md)
- [Privacy disclosures](legal/app-store-privacy-disclosures.md)
