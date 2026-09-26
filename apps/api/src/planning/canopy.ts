import { randomUUID } from 'node:crypto';
import { PreparationTasks } from './preparationTasks';
import {
  CANOPY_DATASET_VERSION,
  adaptLegacyRoute,
  unavailableCanopyEvidence,
  type CanopyEvidenceProfile,
} from '@runcast/core';
import { canopyRegionForRoute } from '../providers/usdaCanopy';
import type { OwnedPlanningRouteRecord } from './service';

export const CANOPY_FAILURE_BACKOFF_MS = 15 * 60_000;

export interface RouteCanopyRepository {
  find(route: OwnedPlanningRouteRecord): Promise<CanopyEvidenceProfile | null>;
  tryAcquireLease(
    route: OwnedPlanningRouteRecord,
    holder: string,
    expiresAt: number,
    now: number,
  ): Promise<boolean>;
  save(
    route: OwnedPlanningRouteRecord,
    holder: string,
    profile: CanopyEvidenceProfile,
  ): Promise<void>;
  fail(
    route: OwnedPlanningRouteRecord,
    holder: string,
    code: string,
    detail: string,
    retryAfter: number,
  ): Promise<void>;
  release(route: OwnedPlanningRouteRecord, holder: string): Promise<void>;
}

export interface RouteCanopyPreparer {
  prepare(route: OwnedPlanningRouteRecord, signal?: AbortSignal): Promise<CanopyEvidenceProfile>;
}

export class CanopyPreparationCoordinator {
  private readonly tasks = new PreparationTasks();

  constructor(
    private readonly repository: RouteCanopyRepository,
    private readonly preparer: RouteCanopyPreparer,
    private readonly leaseMs = 2 * 60_000,
  ) {}

  private key(route: OwnedPlanningRouteRecord): string {
    return `${route.id}:${route.coordinateHash}:${CANOPY_DATASET_VERSION}`;
  }

  isPreparing(route: OwnedPlanningRouteRecord): boolean {
    return this.tasks.has(this.key(route));
  }

  close(timeoutMs = 10_000): Promise<boolean> {
    return this.tasks.close(timeoutMs);
  }

  private launch(route: OwnedPlanningRouteRecord, now: number): Promise<void> | null {
    return this.tasks.run(
      this.key(route),
      async (signal) => {
        const holder = randomUUID();
        const startedAt = Date.now();
        let acquired = false;
        try {
          acquired = await this.repository.tryAcquireLease(route, holder, now + this.leaseMs, now);
          if (!acquired || signal.aborted) return;
          try {
            const profile = await this.preparer.prepare(route, signal);
            if (signal.aborted) return;
            await this.repository.save(route, holder, profile);
            console.log(
              JSON.stringify({
                level: 'info',
                event: 'canopy.v3-prepared',
                provider: profile.provider,
                providerLatencyMs: Date.now() - startedAt,
                cacheStatus: 'miss',
                completeness: profile.completeness,
                modelDeltaEligibleSamples: profile.canopyPct.filter((value) => value !== null)
                  .length,
              }),
            );
          } catch (error) {
            if (signal.aborted) return;
            const code =
              error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'provider';
            await this.repository.fail(
              route,
              holder,
              code,
              error instanceof Error ? error.name : 'unknown',
              Date.now() + CANOPY_FAILURE_BACKOFF_MS,
            );
            throw error;
          }
        } finally {
          if (acquired && !signal.aborted) await this.repository.release(route, holder);
        }
      },
      (error) => {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'canopy.v3-failed',
            routeId: route.id,
            cacheStatus: 'miss',
            completeness: 'unavailable',
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
      },
    );
  }

  start(route: OwnedPlanningRouteRecord, now: number): void {
    void this.launch(route, now);
  }

  prepareAndWait(
    route: OwnedPlanningRouteRecord,
    now: number,
  ): Promise<CanopyEvidenceProfile | null> {
    return this.tasks.readAfter(this.launch(route, now), () => this.repository.find(route));
  }
}

export function unknownCanopyForRoute(route: OwnedPlanningRouteRecord): CanopyEvidenceProfile {
  const planningRoute = route.planningRoute ?? adaptLegacyRoute(route.route);
  return unavailableCanopyEvidence(
    planningRoute,
    route.coordinateHash,
    ['canopy.unavailable'],
    canopyRegionForRoute(planningRoute),
  );
}
