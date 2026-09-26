# Runcast privacy notice

_Publication candidate — legal and App Store review is required before beta submission._

Runcast works in guest mode without an account. Guest routes and preferences remain on the device. To produce forecasts and map context, the app sends route-adjacent locations or map viewports directly to Open-Meteo, OpenStreetMap services, and OpenFreeMap. Guest imports keep their existing on-device OpenStreetMap woodland lookup and are not sent to Runcast or USDA for canopy processing. Those providers receive the network information normally included in an internet request. Route data is sent to the Runcast API only after the user signs in and explicitly saves or imports it to the account.

When a user signs in, Runcast stores a provider-neutral account ID; linked Strava athlete and/or Apple account identifiers; optional name and email; preferences; explicitly saved route geometry and imported running activity data; Strava scopes; route watches; recommendation snapshots; device installation metadata; and notification delivery state. Provider refresh tokens are encrypted at rest. Runcast hashes its own refresh tokens and does not store the opaque token value.

Runcast uses:

- Strava for account sign-in and, when authorized, listing and importing running routes;
- Apple as an optional account sign-in or recovery method;
- Open-Meteo for route forecasts;
- USDA Forest Service Tree Canopy Cover services for numeric canopy evidence along routes explicitly saved to an account;
- Expo for optional push delivery;
- Render for API and PostgreSQL hosting;
- OpenStreetMap/OpenFreeMap/MapLibre for route context and mapping;
- Sentry for minimized mobile crash and session-health diagnostics when configured.

Route geometry can reveal sensitive location patterns. It is never used for advertising or sold. For explicitly saved routes, Runcast sends sampled coordinates to the USDA Forest Service canopy service and stores the resulting canopy profile. Logs redact tokens, GPX bodies, coordinates, route names, provider payloads, request bodies, and push tokens. Canopy logs contain only aggregate latency, cache state, completeness, and model deltas. Operational logs use request/job references and pseudonymous identifiers.

Sentry is mobile-only and is disabled when its DSN is not configured. Runcast sends error reports and aggregate session health, but disables tracing, profiling, replay, screenshots, view hierarchy, request capture, logs, and default PII. A final outbound sanitizer removes account identity, route names and geometry, provider payloads, request bodies, tokens, and push tokens. Sentry events are not associated with a Runcast user identity.

Users can disable notification permission in iOS, sign out, or permanently delete the account in the app. Signing out revokes only the Runcast session and retains the account, linked providers, and server data. Account deletion attempts to revoke linked Apple and Strava credentials, deletes owned database records through cascading foreign keys, disables the local session, and wipes user-scoped caches. Only a non-identifying deletion event is retained.

Support and privacy requests: support@runcast.app. This draft must be published at the production privacy URL before TestFlight review.
