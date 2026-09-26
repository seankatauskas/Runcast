# Mobile beta journeys

The Maestro suite under `.maestro/` covers the deterministic, account-free beta journey on both
iOS and Android. It exercises the shipped screens and durable SQLite route store; it does not mock
the Files picker, either OAuth provider, or push delivery.

## Safety boundary

The fixture and provider seam are enabled only when both `EXPO_PUBLIC_APP_ENV=e2e` and
`EXPO_PUBLIC_E2E_MODE=enabled` are present while Metro creates the JavaScript bundle. The dynamic
Expo config rejects the E2E flag in any other environment and gives the test variant separate
application IDs (`com.seankatauskas.runcast.e2e`) and scheme (`runcast-e2e`). Preview and
production profiles cannot enable the seam through a runtime argument or deep link.

The E2E forecast client returns deterministic normalized V2 conditions for the isolated binary.
The fixture route's first request fails and its retry succeeds. Production builds continue through
the live provider client.

## Build and run

Use Node 22.13 or newer. The EAS profile creates a self-contained iOS Simulator build:

```sh
cd apps/mobile
npx eas-cli@21.0.2 build --platform ios --profile e2e
```

Install the resulting `.app` on a booted Simulator, then run the workspace from the repository
root:

```sh
maestro test .maestro
```

For the local CNG loop, set the same two build variables for both prebuild and compile so Expo
generates the isolated application variant:

```sh
cd apps/mobile
EXPO_PUBLIC_APP_ENV=e2e EXPO_PUBLIC_E2E_MODE=enabled npx expo prebuild --clean
EXPO_PUBLIC_APP_ENV=e2e EXPO_PUBLIC_E2E_MODE=enabled npx expo run:ios --configuration Release
```

Regenerate ignored native directories before switching variants. Never set the E2E variables in
preview, production, TestFlight, or an update published to those channels.

## Automated coverage

| Flow                      | Contract exercised                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `introduction-demo`       | Clean first run, all introduction pages, completion, bundled demo conditions, full plan       |
| `route-library-lifecycle` | Fixture GPX parse/save, exact geometry dedup, rename, process restart persistence, deletion   |
| `prerun-briefing`         | Recommended briefing, tomorrow selection, finish-time consistency across Planner and Explorer |
| `forecast-retry`          | Real loading/error UI, explicit retry, deterministic V2 forecast recovery                     |
| `notification-deep-links` | Valid saved-route link and signed-out missing-route terminal state                            |

The deep-link flow exercises the same Expo Router URL contract used by a notification response. A
real APNs/FCM delivery and tap remains a physical-device check. A server-confirmed deleted route
also remains manual because reproducing it requires a real authenticated sync; the automated suite
does not invent an OAuth session.

## Physical-device beta matrix

Record device model, OS, build number, release SHA, account, network state, outcome, and evidence
for every row.

| Area                    | Required states                                                                              | Expected result                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Files GPX               | iCloud Drive and On My iPhone; valid, malformed, exact duplicate, cancel; restart after save | Picker returns to Runcast cleanly; valid route persists with original GPX; malformed import is actionable; duplicate selects one route without creating another    |
| Strava OAuth/import     | First sign-in, consent cancel, successful link/import, expired authorization, sign-out       | Callback returns to the correct build; cancel is recoverable; imported routes are owner-scoped; expired auth prompts reconnect; sign-out removes the local session |
| Sign in with Apple      | Cancel, first success, returning success, credential revoked                                 | No session on cancel; account identity is stable on return; revoked credentials become signed out without exposing tokens                                          |
| Notification permission | Fresh deny, later approve from Settings, already approved                                    | Account screen distinguishes OS permission, project/token readiness, and server registration; denial never blocks planning                                         |
| Push token              | First registration, app reinstall, token rotation, sign-out                                  | Current token replaces the old token; stale device rows deactivate; sign-out deactivates or durably queues deactivation                                            |
| Notification delivery   | Foreground, background, terminated; tap each once                                            | One response opens the intended route/start exactly once and records acknowledgement without duplicate navigation                                                  |
| Missing/deleted route   | Offline unknown route, signed-out route, server-confirmed deleted route                      | A terminal state explains offline retry, sign-in, not-found, or deletion and always offers Back to Explorer                                                        |
| Connectivity            | Lose network during forecast refresh and route mutation, then restore                        | Cached plan remains readable; retry recovers; queued rename/delete converges without route resurrection                                                            |
| Accessibility           | VoiceOver, largest Dynamic Type, Reduce Motion, light/dark mode                              | Controls remain named and reachable; dialogs and terminal states keep logical focus/order; content is not clipped                                                  |

Do not mark the device matrix complete using Simulator URL injection, mocked auth, or locally
constructed notification payloads.
