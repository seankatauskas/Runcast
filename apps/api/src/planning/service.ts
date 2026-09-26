import { randomUUID } from 'node:crypto';
import { PreparationTasks } from './preparationTasks';
import type { PlanningBundleV3 } from '@runcast/contracts';
import {
  contentIdentity,
  forecastIsFresh,
  type LegacyCoverageMask,
  type PlanningRoute,
  type LegacyRoute,
  type CanopyModelMode,
} from '@runcast/core';
import { assemblePlanningBundleV3, type PreparedRouteForecast } from './bundle';
import {
  CanopyPreparationCoordinator,
  unknownCanopyForRoute,
  type RouteCanopyPreparer,
  type RouteCanopyRepository,
} from './canopy';

export interface OwnedPlanningRouteRecord {
  id: string;
  ownerId: string;
  route: LegacyRoute;
  planningRoute: PlanningRoute | null;
  coverage: LegacyCoverageMask;
  timezone: string;
  coordinateHash: string;
}

export interface RouteForecastRepository {
  findOwnedRoute(ownerId: string, routeId: string): Promise<OwnedPlanningRouteRecord | null>;
  findPreparedForecast(routeId: string): Promise<PreparedRouteForecast | null>;
  tryAcquireLease(routeId: string, holder: string, expiresAt: number): Promise<boolean>;
  savePreparedForecast(
    routeId: string,
    holder: string,
    preparedForecast: PreparedRouteForecast,
  ): Promise<void>;
  releaseLease(routeId: string, holder: string): Promise<void>;
}

export interface RouteForecastPreparer {
  prepare(route: OwnedPlanningRouteRecord, signal?: AbortSignal): Promise<PreparedRouteForecast>;
}

export type PlanningBundleDeliveryResult =
  | { status: 'ready'; bundle: PlanningBundleV3; etag: string }
  | { status: 'not-modified'; etag: string }
  | { status: 'preparing'; retryAfterSeconds: number }
  | { status: 'update-required'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'not-found' };

export interface PlanningBundleDeliveryRequest {
  ownerId: string;
  routeId: string;
  reader: string | undefined;
  evaluatorBuild: string | undefined;
  ifNoneMatch?: string;
  now?: number;
}

export class ForecastPreparationCoordinator {
  private readonly tasks = new PreparationTasks();
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly repository: RouteForecastRepository,
    private readonly preparer: RouteForecastPreparer,
    private readonly leaseMs = 2 * 60_000,
  ) {}

  isPreparing(routeId: string): boolean {
    return this.tasks.has(routeId);
  }

  recentlyFailed(routeId: string, now: number): boolean {
    const failedAt = this.failures.get(routeId);
    return failedAt !== undefined && now - failedAt < 30_000;
  }

  close(timeoutMs = 10_000): Promise<boolean> {
    return this.tasks.close(timeoutMs);
  }

  private launch(route: OwnedPlanningRouteRecord, now: number): Promise<void> | null {
    return this.tasks.run(
      route.id,
      async (signal) => {
        const holder = randomUUID();
        const startedAt = Date.now();
        let acquired = false;
        try {
          acquired = await this.repository.tryAcquireLease(route.id, holder, now + this.leaseMs);
          if (!acquired || signal.aborted) return;
          // No repository transaction is held across this provider call.
          const preparedForecast = await this.preparer.prepare(route, signal);
          if (signal.aborted) return;
          await this.repository.savePreparedForecast(route.id, holder, preparedForecast);
          this.failures.delete(route.id);
          console.log(
            JSON.stringify({
              level: 'info',
              event: 'forecast.v2-prepared',
              routeId: route.id,
              provider: preparedForecast.forecast.provider,
              providerLatencyMs: Date.now() - startedAt,
              normalizationVersion: preparedForecast.forecast.normalizationVersion,
              validUntil: new Date(preparedForecast.validUntil).toISOString(),
            }),
          );
        } finally {
          // An abandoned lease expires naturally; shutdown must not start more DB work.
          if (acquired && !signal.aborted) await this.repository.releaseLease(route.id, holder);
        }
      },
      (error) => {
        this.failures.set(route.id, Date.now());
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'forecast.v2-failed',
            routeId: route.id,
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
      },
    );
  }

  start(route: OwnedPlanningRouteRecord, now: number): void {
    void this.launch(route, now);
  }

  /** Used by cron outside a DB transaction; a competing lease yields null. */
  prepareAndWait(
    route: OwnedPlanningRouteRecord,
    now: number,
  ): Promise<PreparedRouteForecast | null> {
    return this.tasks.readAfter(this.launch(route, now), () =>
      this.repository.findPreparedForecast(route.id),
    );
  }
}

export class PlanningBundleService {
  readonly coordinator: ForecastPreparationCoordinator;
  readonly canopyCoordinator: CanopyPreparationCoordinator | null;

  constructor(
    private readonly repository: RouteForecastRepository,
    preparer: RouteForecastPreparer,
    private readonly canopyRepository?: RouteCanopyRepository,
    canopyPreparer?: RouteCanopyPreparer,
    private readonly canopyModelMode: Exclude<CanopyModelMode, 'shadow'> = 'off',
  ) {
    this.coordinator = new ForecastPreparationCoordinator(repository, preparer);
    this.canopyCoordinator =
      canopyRepository && canopyPreparer
        ? new CanopyPreparationCoordinator(canopyRepository, canopyPreparer)
        : null;
  }

  async close(timeoutMs = 10_000): Promise<boolean> {
    const results = await Promise.all([
      this.coordinator.close(timeoutMs),
      this.canopyCoordinator?.close(timeoutMs) ?? true,
    ]);
    return results.every(Boolean);
  }

  async get(request: PlanningBundleDeliveryRequest): Promise<PlanningBundleDeliveryResult> {
    if (request.reader !== '3' || !request.evaluatorBuild?.trim()) {
      return {
        status: 'update-required',
        reason: 'Bundle reader 3 and evaluator build are required',
      };
    }
    const route = await this.repository.findOwnedRoute(request.ownerId, request.routeId);
    if (!route) return { status: 'not-found' };
    const now = request.now ?? Date.now();
    const preparedForecast = await this.repository.findPreparedForecast(route.id);
    if (
      !preparedForecast ||
      preparedForecast.validUntil < now ||
      preparedForecast.validFrom > now
    ) {
      if (this.coordinator.recentlyFailed(route.id, now)) {
        return { status: 'unavailable', reason: 'No valid forecast artifact exists' };
      }
      this.coordinator.start(route, now);
      return { status: 'preparing', retryAfterSeconds: 5 };
    }
    if (
      !forecastIsFresh(preparedForecast.fetchedAt, now) &&
      !this.coordinator.recentlyFailed(route.id, now)
    ) {
      this.coordinator.start(route, now);
    }
    const storedCanopy = (await this.canopyRepository?.find(route)) ?? null;
    const bundle = assemblePlanningBundleV3({
      route,
      preparedForecast,
      canopy: storedCanopy ?? unknownCanopyForRoute(route),
      canopyModelMode: this.canopyModelMode,
      evaluatorBuild: request.evaluatorBuild,
      now,
    });
    if (this.canopyModelMode === 'active') this.canopyCoordinator?.start(route, now);
    const etag = `"${contentIdentity({
      bundle,
      reader: request.reader,
      evaluatorBuild: request.evaluatorBuild,
    })}"`;
    return request.ifNoneMatch === etag
      ? { status: 'not-modified', etag }
      : { status: 'ready', bundle, etag };
  }
}
