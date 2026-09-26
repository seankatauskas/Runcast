# External TestFlight beta checklist

## Accounts and metadata

- [ ] Active Apple Developer membership, App ID, Sign in with Apple key, APNs credentials, and EAS project ID.
- [ ] Strava API app with staging and production callback URLs.
- [ ] Render Blueprint synced with all `sync: false` secrets supplied.
- [ ] Privacy, support, deletion, and disclaimer documents published at accessible URLs.
- [ ] App Store privacy disclosures, export-compliance response, reviewer notes, screenshots, and guest-mode instructions complete.

## Release gates

- [ ] Full-history secret scan and dependency review pass.
- [ ] CI, PostgreSQL integration test, web build, Expo config, Expo Doctor, and staging smoke test pass on Node 22.
- [ ] EAS environments contain mobile Sentry DSN/org/project plus a sensitive source-map token; a preview crash is symbolicated and contains no prohibited data.
- [ ] Archived iOS `PrivacyInfo.xcprivacy` matches the disclosure matrix and Apple's TestFlight required-reason validation reports no omissions.
- [ ] Beta testers have been told that the Strava-first reset requires signing in again after update.
- [ ] Production-like restore drill and API/database/mobile OTA rollback rehearsal recorded.
- [ ] Physical-device flow succeeds: cold install → guest plan → Strava sign-in → import → sign out → Strava sign-in → same saved data.
- [ ] Physical-device recovery flow succeeds: Strava sign-in → add Apple → sign out → Apple sign-in → same account and saved data.
- [ ] Apple-first flow succeeds: Apple sign-in → link Strava → import → watch → remote notification → deep-linked plan.
- [ ] Real Apple credential-state/revocation behavior and Strava private-route `read_all` behavior validated.
- [ ] Notification denial leaves watches usable; `DeviceNotRegistered` disables the installation.

## One-week beta

- [ ] Beta App Review approved and five external testers invited.
- [ ] Every tester completes authenticated import/watch at least once.
- [ ] At least five scheduled notifications are delivered and opened.
- [ ] Zero unresolved critical/high defects, ≥99% crash-free sessions, and API 5xx <1%.
- [ ] Feedback, cron duration, provider failures, push receipts, and database capacity reviewed before résumé claims are updated.
