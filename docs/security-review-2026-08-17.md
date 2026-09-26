# Repository review — 2026-08-17

## Outcome

The frozen repository checkpoint received complete local review across the API, mobile clients, shared packages, web application, database migrations, scheduled work, build configuration, workflows, infrastructure definitions, tests, documentation, and repository history.

All locally reproducible release-blocking items were corrected and covered by regression tests. The tracked-file coverage manifest is fully dispositioned, and the remediated tree passes the local repository, database, mobile-configuration, dependency-policy, and container gates described below.

The release decision is **CONDITIONAL GO**. Local acceptance is complete; the staging and physical-device gate remains mandatory before production release.

## Review basis

- Review scope: the product tree incorporated into the initial public snapshot
- Publication note: post-review edits were limited to public-history and deployment-documentation metadata
- Standards: OWASP ASVS Level 2, OWASP API Security Top 10, OWASP MASVS, CWE, and CVSS 4.0
- Manual coverage: all 466 tracked files were assigned a primary reviewer; 398 received line review and 68 generated/binary assets received provenance and compiled-effect review
- Cross-boundary coverage: identity/session flows, every API route, persisted data groups, mobile account lifecycle, scheduled delivery, external providers, build inputs, and release paths
- Independent verification: release-blocking corrections were checked by reviewers other than their implementers

Detailed evidence, raw tool output, reproductions, and the complete register are retained in the access-restricted local review bundle and are intentionally excluded from the repository document.

## Remediation themes

The completed corrections strengthen:

- session lifecycle and provider identity binding;
- account-scoped mobile work and environment-specific app identity;
- route-input and background-work resource bounds;
- concurrent creation and scheduled-processing behavior;
- deterministic container and workflow inputs; and
- release-source and tag validation.

No public API, notification payload, or database migration required a breaking change. Existing `/v1` and `/v2` compatibility is preserved.

## Verified local gates

- Clean dependency installation with the repository lockfile
- Formatting, naming boundaries, TypeScript checks, and web production build
- Complete unit and integration suites with PostgreSQL 17 migrations
- Concurrent session and watch operations plus scheduler regression coverage
- Expo SDK compatibility, public configuration matrices, and generated configuration inspection
- Production container build, non-root runtime, readiness checks, and loopback-only local database exposure
- Dependency release policy, immutable workflow/build-input policy, and release-script tests
- Full-history credential scan, dependency and filesystem analysis, source analysis, SBOM, and license inventory

## Prioritized follow-up backlog

| Priority | Workstream                                                                                                | Owner                  | Target                    |
| -------- | --------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------- |
| P1       | Complete staging environment, release-protection, preview identity, and provider configuration evidence   | Release engineering    | Before production release |
| P1       | Run the two-account staging API and physical iPhone preview journey, including real delivery and deletion | API + Mobile           | Before production release |
| P2       | Retire time-boxed build-tool dependency exceptions when the compatible upstream update is available       | Mobile platform        | Next dependency cycle     |
| P2       | Exercise restore, rollback, alerting, and release-identity procedures with retained evidence              | Operations             | Next operations milestone |
| P2       | Reduce the largest web production bundle and record an explicit performance budget                        | Web                    | Next web milestone        |
| P3       | Continue documentation-drift and generated-artifact checks as part of routine maintenance                 | Repository maintainers | Ongoing                   |

## Mandatory release gate

Before changing the decision to **GO**, complete the documented non-destructive staging checks using disposable accounts and owned test data, verify the preview build on a physical iPhone, confirm Render/EAS/Sentry release identity and rollback evidence, and retain the results in the private review bundle. Production testing, denial-of-service activity, credential attacks, and destructive shared-state testing remain out of scope.
