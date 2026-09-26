# App Store privacy disclosure matrix

_Submission working copy — confirm against the archived release binary and App Store Connect wording before every submission._

Runcast does not track users across apps or websites, sell data, or use data for advertising. `NSPrivacyTracking` is `false`, and no tracking domains are declared. Collection below means transmission off the device for longer than the time required to service the immediate request; direct guest forecast and map-provider requests are separately disclosed in the privacy notice.

| App Store category                  | Example                                                                                                                          | Collected                     | Linked to identity | Tracking | Purpose                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------ | -------- | -------------------------------------- |
| Contact info — name                 | Optional Apple/Strava display name                                                                                               | Yes, for signed-in accounts   | Yes                | No       | App functionality                      |
| Contact info — email                | Optional Apple email                                                                                                             | Yes, for signed-in accounts   | Yes                | No       | App functionality and account recovery |
| Identifiers — user ID               | Provider-neutral Runcast ID and linked provider subject                                                                          | Yes                           | Yes                | No       | Authentication and app functionality   |
| Identifiers — device ID             | Random Runcast installation ID and optional Expo installation token                                                              | Yes                           | Yes when signed in | No       | Sessions, sync, and notifications      |
| Location — precise location         | Geometry in a route explicitly saved/imported to an account, including sampled coordinates processed by USDA for canopy evidence | Yes                           | Yes                | No       | Route planning and watches             |
| Health & fitness — fitness          | Running routes and activity data explicitly imported from Strava                                                                 | Yes                           | Yes                | No       | Route planning and watches             |
| User content — other                | Saved route name/GPX, preferences, and watch configuration                                                                       | Yes                           | Yes                | No       | App functionality                      |
| Usage data — product interaction    | Aggregate mobile session health                                                                                                  | Yes when Sentry is configured | No                 | No       | App stability                          |
| Diagnostics — crash data            | Sanitized mobile crash report                                                                                                    | Yes when Sentry is configured | No                 | No       | App functionality                      |
| Diagnostics — other diagnostic data | Sanitized error metadata and aggregate session health                                                                            | Yes when Sentry is configured | No                 | No       | App functionality                      |

Do **not** select analytics, performance data, advertising, or other tracking categories for the current binary. Product interaction is limited to unlinked aggregate session-health collection. Sentry tracing, profiling, replay, screenshots, view hierarchy, logs, failed-request capture, and default PII are explicitly disabled. Revisit this matrix before enabling any new telemetry or provider.

## Privacy manifest mapping

The durable Expo configuration in `apps/mobile/app.json` declares Name, Email Address, User ID, Device ID, Precise Location, Fitness, Other User Content, Product Interaction, Crash Data, and Other Diagnostic Data with the linkage and purpose above. It also aggregates required-reason API declarations used by Expo, React Native, Async Storage, and file handling:

| Required-reason category | Reasons in the app manifest  |
| ------------------------ | ---------------------------- |
| User defaults            | `CA92.1`                     |
| File timestamps          | `0A2A.1`, `3B52.1`, `C617.1` |
| Disk space               | `85F4.1`, `E174.1`           |
| System boot time         | `35F9.1`                     |

After generating the release archive, inspect the merged `PrivacyInfo.xcprivacy`, compare all dependency manifests, and use Apple's TestFlight validation email as a final required-reason check.
