import { planningBundleV2Schema, routeBundleSchema, routeSummarySchema } from '@runcast/contracts';
import { adaptLegacyRoute, contentIdentity } from '@runcast/core';
import type { SQLiteDatabase } from 'expo-sqlite';
import { legacyCoverageAsWoodlandEvidence } from './compatibility/legacyPlanningAdapters';
import { parseAndVerifyPlanningBundle } from './planningBundle';
import { serializeCloudRoute, type CachedCloudRoute } from './cloudRoutes';

/** One-time cache conversion. Old weather is never promoted to a current evaluation. */
export async function migrateCloudRouteCache(db: SQLiteDatabase): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await tx.getFirstAsync("SELECT id FROM cache_migrations WHERE id = 'cloud-routes-v3'"))
      return;
    const accounts = await tx.getAllAsync<{ user_id: string; body: string }>(
      "SELECT user_id, body FROM cache_entries WHERE kind = 'account' AND cache_key = 'routes'",
    );
    for (const account of accounts) {
      let summaries: unknown;
      try {
        summaries = JSON.parse(account.body);
      } catch {
        continue;
      }
      if (!Array.isArray(summaries)) continue;
      for (const raw of summaries) {
        const parsed = routeSummarySchema.safeParse(raw);
        if (!parsed.success) continue;
        const summary = parsed.data;
        const legacy = await tx.getFirstAsync<{ body: string }>(
          "SELECT body FROM cache_entries WHERE user_id = ? AND kind = 'route-bundle' AND cache_key = ?",
          account.user_id,
          summary.id,
        );
        const planning = await tx.getFirstAsync<{
          body: string;
          etag: string;
          installed_at: number;
        }>(
          'SELECT body, etag, installed_at FROM planning_bundles_v2 WHERE user_id = ? AND route_id = ?',
          account.user_id,
          summary.id,
        );
        let oldBundle: ReturnType<typeof routeBundleSchema.parse> | null = null;
        try {
          oldBundle = legacy ? routeBundleSchema.parse(JSON.parse(legacy.body)) : null;
        } catch {
          /* Preserve malformed source rows for inspection. */
        }
        let row: CachedCloudRoute | null = null;
        if (planning) {
          try {
            const bundle = parseAndVerifyPlanningBundle(planning.body);
            if (bundle.route.data.id === summary.id)
              row = {
                userId: account.user_id,
                summary,
                timezone: oldBundle?.timezone ?? null,
                content: {
                  kind: 'planning',
                  planning: {
                    userId: account.user_id,
                    routeId: summary.id,
                    body: planning.body,
                    etag: planning.etag,
                    installedAt: planning.installed_at,
                    bundle,
                  },
                },
                syncState: 'not-modified',
              };
          } catch {
            // V2 is accepted only by this migration, as geometry/evidence.
            try {
              const old = planningBundleV2Schema.parse(JSON.parse(planning.body));
              if (
                old.route.data.id === summary.id &&
                contentIdentity({ data: old.route.data }) === old.route.contentHash &&
                contentIdentity({ coverage: old.environment.coverage }) ===
                  old.environment.contentHash
              )
                row = {
                  userId: account.user_id,
                  summary,
                  timezone: oldBundle?.timezone ?? null,
                  content: {
                    kind: 'route',
                    route: old.route,
                    woodlandEvidence: old.environment.coverage,
                  },
                  syncState: 'unavailable',
                };
            } catch {
              /* Try the independently validated geometry-only source. */
            }
          }
        }
        if (!row && oldBundle?.route.id === summary.id) {
          const data = adaptLegacyRoute(oldBundle.route);
          row = {
            userId: account.user_id,
            summary,
            timezone: oldBundle.timezone,
            content: {
              kind: 'route',
              route: { schemaVersion: 2, contentHash: contentIdentity({ data }), data },
              woodlandEvidence: legacyCoverageAsWoodlandEvidence(
                oldBundle.coverage,
                'migrated-route-cache',
              ),
            },
            syncState: 'unavailable',
          };
        }
        if (!row) continue;
        await tx.runAsync(
          'INSERT OR IGNORE INTO cloud_routes (user_id, route_id, body) VALUES (?, ?, ?)',
          account.user_id,
          summary.id,
          serializeCloudRoute(row),
        );
        await tx.runAsync(
          "DELETE FROM cache_entries WHERE user_id = ? AND kind = 'route-bundle' AND cache_key = ?",
          account.user_id,
          summary.id,
        );
        await tx.runAsync(
          'DELETE FROM planning_bundles_v2 WHERE user_id = ? AND route_id = ?',
          account.user_id,
          summary.id,
        );
      }
    }
    await tx.runAsync("INSERT INTO cache_migrations(id) VALUES ('cloud-routes-v3')");
  });
}
