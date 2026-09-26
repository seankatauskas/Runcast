# Contributing

Use Node 22 and npm. Start PostgreSQL with `docker compose up -d postgres`, then run `npm install`, `npm run migrate -w apps/api`, and `npm test`.

Run `npm run hooks:install` to enable the checked-in pre-commit hook. It runs
`npm run architecture:check`, the same blocking command used in CI, without needing PostgreSQL.
The command checks domain naming, rejects retired evaluator imports and rollout flags, and prevents
planning policy from loading database drivers or deployment configuration. Historical versioned
DTOs remain valid at storage and contract boundaries. CI runs it regardless of whether local hooks are installed.

Changes should keep `@runcast/core` framework-independent, add API shapes to `@runcast/contracts` before consuming them, and preserve the mobile and web guest flows. Never commit `.env` files, GPX uploads, provider tokens, push tokens, Apple keys, production coordinates, or database exports.

Before opening a pull request, run:

```sh
npm run format:check
npm run architecture:check
npm run typecheck
npm test
npm run build -w apps/web
```

Database changes use checked-in forward migrations. Preserve historical serialized data and validate
upgrade-required behavior when a client protocol is retired. The current-only cutover requires the
reader-3 native mobile build; follow the coordinated deployment steps in docs/operations.md.
