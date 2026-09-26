# Dependency audit policy

The release gate runs `npm audit --omit=dev --json` through
`scripts/check-dependency-audit.mjs`. It fails on every new high or critical direct advisory and on
every critical aggregate path. A reviewed exception must name the advisory, explain the reachable
surface, and expire so it cannot become permanent.

## Temporary SDK 57 exceptions

Reviewed through **September 15, 2026**:

- `GHSA-w3rx-r6r6-pgpr` (`image-size`, ICNS parser denial of service)
- `GHSA-5p2g-fcmc-qvqq` (`image-size`, JXL/HEIF parser denial of service)

Both enter through Metro in the Expo SDK 57 build toolchain. Runcast does not parse user-supplied
images with Metro: builds process only assets committed to this repository. The npm suggested fix
is an incompatible Expo downgrade, so the beta uses the current Expo-recommended SDK 57 graph and
must re-check for a compatible Metro/image-size patch before the exception expires.

The audit also reports a moderate `uuid` advisory through Expo's Xcode project build tooling. The
affected name-based UUID buffer API is not called by Runcast, but it remains part of the monthly
dependency review and should be removed by the next compatible Expo patch.

An exception is not permission to ignore a new dependency path. If Runcast begins processing
untrusted images during build or runtime, these image parser advisories become release blockers
immediately.
