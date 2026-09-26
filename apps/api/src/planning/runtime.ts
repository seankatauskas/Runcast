/** Production dependencies are composed here; planning policy stays configuration-free. */
import {
  adaptLegacyRoute,
  fetchNormalizedRouteForecast,
  type CanopyEvidenceProfile,
} from '@runcast/core';
import { config } from '../config';
import { acquireCanopyEvidence } from '../providers/usdaCanopy';
import { preparedRouteForecastFromForecast, type PreparedRouteForecast } from './bundle';
import type { RouteCanopyPreparer } from './canopy';
import { PostgresRouteCanopyRepository, PostgresRouteForecastRepository } from './postgres';
import {
  PlanningBundleService,
  type OwnedPlanningRouteRecord,
  type RouteForecastPreparer,
} from './service';

export class OpenMeteoRouteForecastPreparer implements RouteForecastPreparer {
  async prepare(
    route: OwnedPlanningRouteRecord,
    signal?: AbortSignal,
  ): Promise<PreparedRouteForecast> {
    const result = await fetchNormalizedRouteForecast(
      route.planningRoute ?? adaptLegacyRoute(route.route),
      signal,
    );
    return preparedRouteForecastFromForecast(result.field, result.timezone);
  }
}

export class UsdaRouteCanopyPreparer implements RouteCanopyPreparer {
  async prepare(
    route: OwnedPlanningRouteRecord,
    signal?: AbortSignal,
  ): Promise<CanopyEvidenceProfile> {
    return acquireCanopyEvidence(
      route.planningRoute ?? adaptLegacyRoute(route.route),
      route.coordinateHash,
      { signal },
    );
  }
}

let defaultService: PlanningBundleService | null = null;

export function defaultPlanningBundleService(): PlanningBundleService {
  if (!defaultService) {
    defaultService = new PlanningBundleService(
      new PostgresRouteForecastRepository(),
      new OpenMeteoRouteForecastPreparer(),
      new PostgresRouteCanopyRepository(),
      new UsdaRouteCanopyPreparer(),
      config.canopyModelMode,
    );
  }
  return defaultService;
}

/** Called after request admission stops and before the database is closed. */
export async function closeDefaultPlanningBundleService(timeoutMs = 10_000): Promise<boolean> {
  return defaultService ? defaultService.close(timeoutMs) : true;
}
