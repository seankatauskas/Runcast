# Security

Do not open public issues for vulnerabilities. Report them privately through GitHub's security-advisory flow once the repository is published, or email the support address listed in [support.md](docs/legal/support.md).

Runcast treats provider credentials, session tokens, push tokens, GPX bodies, and coordinates as sensitive. Logs must never include them. Production secrets belong in Render/EAS secret stores, not Git, `.env` files, build logs, screenshots, or database exports.

Before a release, run a full-history secret scan, review `npm audit`, rotate any credential that may have been exposed, and confirm Apple/Strava callback URLs exactly match the production API domain.
