import {
  canopyEvidenceV3Schema,
  normalizedWeatherFieldV2Schema,
  plannableRouteV2Schema,
  type CanopyEvidenceV3,
} from '@runcast/contracts';
import {
  CANOPY_DATASET_VERSION,
  contentIdentity,
  type CanopyEvidenceProfile,
  type NormalizedRouteForecast,
} from '@runcast/core';
import { and, eq } from 'drizzle-orm';
import { db, sql } from '../db/client';
import { routeCanopyProfiles, routeForecasts, routes } from '../db/schema';
import type { PreparedRouteForecast } from './bundle';
import { CANOPY_FAILURE_BACKOFF_MS, type RouteCanopyRepository } from './canopy';
import type { OwnedPlanningRouteRecord, RouteForecastRepository } from './service';

export class PostgresRouteForecastRepository implements RouteForecastRepository {
  async findOwnedRoute(ownerId: string, routeId: string): Promise<OwnedPlanningRouteRecord | null> {
    const [row] = await db
      .select()
      .from(routes)
      .where(and(eq(routes.id, routeId), eq(routes.ownerId, ownerId)))
      .limit(1);
    return row
      ? {
          id: row.id,
          ownerId: row.ownerId,
          route: row.canonicalRoute,
          planningRoute: row.canonicalRouteV2
            ? (plannableRouteV2Schema.safeParse(row.canonicalRouteV2).data ?? null)
            : null,
          coverage: row.coverageMask,
          timezone: row.timezone,
          coordinateHash: row.coordinateHash,
        }
      : null;
  }

  async findPreparedForecast(routeId: string): Promise<PreparedRouteForecast | null> {
    const [row] = await db
      .select({
        weather: routeForecasts.weatherV2,
        fetchedAt: routeForecasts.fetchedAt,
        validFrom: routeForecasts.validFrom,
        validUntil: routeForecasts.validUntil,
        forecastCoordinateHash: routeForecasts.coordinateHash,
        routeCoordinateHash: routes.coordinateHash,
        timezone: routes.timezone,
      })
      .from(routeForecasts)
      .innerJoin(routes, eq(routes.id, routeForecasts.routeId))
      .where(eq(routeForecasts.routeId, routeId))
      .limit(1);
    if (
      !row?.weather ||
      !row.fetchedAt ||
      !row.validFrom ||
      !row.validUntil ||
      row.forecastCoordinateHash !== row.routeCoordinateHash
    ) {
      return null;
    }
    const parsed = normalizedWeatherFieldV2Schema.safeParse(row.weather);
    if (!parsed.success) return null;
    return {
      forecast: parsed.data as NormalizedRouteForecast,
      timezone: row.timezone,
      fetchedAt: row.fetchedAt.getTime(),
      validFrom: row.validFrom.getTime(),
      validUntil: row.validUntil.getTime(),
    };
  }

  async tryAcquireLease(routeId: string, holder: string, expiresAt: number): Promise<boolean> {
    const rows = await sql`
      INSERT INTO route_forecasts (
        route_id, coordinate_hash, provider_status,
        preparation_lease_owner, preparation_lease_expires_at, updated_at
      )
      SELECT id, coordinate_hash, 'preparing', ${holder},
             ${new Date(expiresAt).toISOString()}::timestamptz, now()
      FROM routes
      WHERE id = ${routeId}
      ON CONFLICT (route_id) DO UPDATE SET
        coordinate_hash = EXCLUDED.coordinate_hash,
        weather_v2 = CASE
          WHEN route_forecasts.coordinate_hash = EXCLUDED.coordinate_hash
          THEN route_forecasts.weather_v2
          ELSE NULL
        END,
        valid_from = CASE
          WHEN route_forecasts.coordinate_hash = EXCLUDED.coordinate_hash
          THEN route_forecasts.valid_from
          ELSE NULL
        END,
        valid_until = CASE
          WHEN route_forecasts.coordinate_hash = EXCLUDED.coordinate_hash
          THEN route_forecasts.valid_until
          ELSE NULL
        END,
        provider_status = 'preparing',
        preparation_lease_owner = EXCLUDED.preparation_lease_owner,
        preparation_lease_expires_at = EXCLUDED.preparation_lease_expires_at,
        updated_at = now()
      WHERE route_forecasts.preparation_lease_expires_at IS NULL
         OR route_forecasts.preparation_lease_expires_at < now()
      RETURNING route_id
    `;
    return rows.length === 1;
  }

  async savePreparedForecast(
    routeId: string,
    holder: string,
    preparedForecast: PreparedRouteForecast,
  ): Promise<void> {
    const updated = await db
      .update(routeForecasts)
      .set({
        weatherV2: preparedForecast.forecast,
        providerName: preparedForecast.forecast.provider,
        providerModel: preparedForecast.forecast.providerModel,
        providerRun: preparedForecast.forecast.providerRun,
        fetchIdentity: preparedForecast.forecast.fetchId,
        contentIdentity: preparedForecast.forecast.contentHash,
        normalizationVersion: preparedForecast.forecast.normalizationVersion,
        fetchedAt: new Date(preparedForecast.fetchedAt),
        validFrom: new Date(preparedForecast.validFrom),
        validUntil: new Date(preparedForecast.validUntil),
        expiresAt: new Date(preparedForecast.validUntil),
        providerStatus: 'ready',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(routeForecasts.routeId, routeId), eq(routeForecasts.preparationLeaseOwner, holder)),
      )
      .returning({ id: routeForecasts.id });
    if (updated.length !== 1) throw new Error('Forecast preparation lease was lost');
  }

  async releaseLease(routeId: string, holder: string): Promise<void> {
    await db
      .update(routeForecasts)
      .set({ preparationLeaseOwner: null, preparationLeaseExpiresAt: null, updatedAt: new Date() })
      .where(
        and(eq(routeForecasts.routeId, routeId), eq(routeForecasts.preparationLeaseOwner, holder)),
      );
  }
}

export class PostgresRouteCanopyRepository implements RouteCanopyRepository {
  async find(route: OwnedPlanningRouteRecord): Promise<CanopyEvidenceProfile | null> {
    const [row] = await db
      .select({ profile: routeCanopyProfiles.profileV3 })
      .from(routeCanopyProfiles)
      .where(
        and(
          eq(routeCanopyProfiles.routeId, route.id),
          eq(routeCanopyProfiles.coordinateHash, route.coordinateHash),
          eq(routeCanopyProfiles.sourceVersion, CANOPY_DATASET_VERSION),
        ),
      )
      .limit(1);
    const parsed = canopyEvidenceV3Schema.safeParse(row?.profile);
    return parsed.success ? (parsed.data as CanopyEvidenceProfile) : null;
  }

  async tryAcquireLease(
    route: OwnedPlanningRouteRecord,
    holder: string,
    expiresAt: number,
    now: number,
  ): Promise<boolean> {
    const rows = await sql`
      INSERT INTO route_canopy_profiles (
        route_id, coordinate_hash, source_version, status,
        preparation_lease_owner, preparation_lease_expires_at, updated_at
      ) VALUES (
        ${route.id}, ${route.coordinateHash}, ${CANOPY_DATASET_VERSION}, 'preparing',
        ${holder}, ${new Date(expiresAt).toISOString()}::timestamptz, now()
      )
      ON CONFLICT (route_id, coordinate_hash, source_version) DO UPDATE SET
        status = 'preparing',
        preparation_lease_owner = EXCLUDED.preparation_lease_owner,
        preparation_lease_expires_at = EXCLUDED.preparation_lease_expires_at,
        updated_at = now()
      WHERE (route_canopy_profiles.preparation_lease_expires_at IS NULL
             OR route_canopy_profiles.preparation_lease_expires_at < now())
        AND (route_canopy_profiles.retry_after IS NULL
             OR route_canopy_profiles.retry_after <= ${new Date(now).toISOString()}::timestamptz)
        AND route_canopy_profiles.status NOT IN ('ready', 'partial', 'unsupported')
      RETURNING route_id
    `;
    return rows.length === 1;
  }

  async save(
    route: OwnedPlanningRouteRecord,
    holder: string,
    profile: CanopyEvidenceProfile,
  ): Promise<void> {
    const parsed = canopyEvidenceV3Schema.parse(profile) as CanopyEvidenceV3;
    const updated = await db
      .update(routeCanopyProfiles)
      .set({
        profileV3: parsed,
        contentHash: contentIdentity(parsed),
        status:
          parsed.region === 'unsupported'
            ? 'unsupported'
            : parsed.completeness === 'complete'
              ? 'ready'
              : parsed.completeness === 'partial'
                ? 'partial'
                : 'failed',
        acquiredAt: parsed.acquiredAt === null ? null : new Date(parsed.acquiredAt),
        retryAfter:
          parsed.region !== 'unsupported' && parsed.completeness === 'unavailable'
            ? new Date(Date.now() + CANOPY_FAILURE_BACKOFF_MS)
            : null,
        failureCode: null,
        failureDetail: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(routeCanopyProfiles.routeId, route.id),
          eq(routeCanopyProfiles.coordinateHash, route.coordinateHash),
          eq(routeCanopyProfiles.sourceVersion, CANOPY_DATASET_VERSION),
          eq(routeCanopyProfiles.preparationLeaseOwner, holder),
        ),
      )
      .returning({ id: routeCanopyProfiles.id });
    if (updated.length !== 1) throw new Error('Canopy preparation lease was lost');
  }

  async fail(
    route: OwnedPlanningRouteRecord,
    holder: string,
    code: string,
    detail: string,
    retryAfter: number,
  ): Promise<void> {
    await db
      .update(routeCanopyProfiles)
      .set({
        status: 'failed',
        retryAfter: new Date(retryAfter),
        failureCode: code.slice(0, 100),
        failureDetail: detail.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(routeCanopyProfiles.routeId, route.id),
          eq(routeCanopyProfiles.coordinateHash, route.coordinateHash),
          eq(routeCanopyProfiles.sourceVersion, CANOPY_DATASET_VERSION),
          eq(routeCanopyProfiles.preparationLeaseOwner, holder),
        ),
      );
  }

  async release(route: OwnedPlanningRouteRecord, holder: string): Promise<void> {
    await db
      .update(routeCanopyProfiles)
      .set({
        preparationLeaseOwner: null,
        preparationLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(routeCanopyProfiles.routeId, route.id),
          eq(routeCanopyProfiles.coordinateHash, route.coordinateHash),
          eq(routeCanopyProfiles.sourceVersion, CANOPY_DATASET_VERSION),
          eq(routeCanopyProfiles.preparationLeaseOwner, holder),
        ),
      );
  }
}
