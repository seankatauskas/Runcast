import { adaptLegacyRoute, type CanopyEvidenceProfile } from '@runcast/core';
import { describe, expect, it, vi } from 'vitest';
import {
  CanopyPreparationCoordinator,
  type RouteCanopyPreparer,
  type RouteCanopyRepository,
} from './canopy';
import type { OwnedPlanningRouteRecord } from './service';

const route: OwnedPlanningRouteRecord = {
  id: 'route-1',
  ownerId: 'owner-1',
  timezone: 'America/Chicago',
  coordinateHash: 'geometry-a',
  planningRoute: null,
  route: {
    id: 'route-1',
    name: 'Fixture',
    points: [
      { lat: 41.9, lon: -87.6, ele: 0 },
      { lat: 41.91, lon: -87.59, ele: 0 },
    ],
    cumulative: [0, 1_000],
    totalDistance: 1_000,
  },
  coverage: { resolution: 50, values: ['unknown'] },
};

function profile(inputRoute = route): CanopyEvidenceProfile {
  return {
    schemaVersion: 3,
    routeDistanceM: [0, 1_000],
    canopyPct: [25, 50],
    standardErrorPct: [2, 4],
    provider: 'fixture',
    region: 'conus',
    datasetYear: 2025,
    datasetVersion: 'v2025-6',
    sourceResolutionM: 30,
    acquiredAt: 1,
    coordinateHash: inputRoute.coordinateHash,
    completeness: 'complete',
    reasons: [],
  };
}

class MemoryRepository implements RouteCanopyRepository {
  profiles = new Map<string, CanopyEvidenceProfile>();
  leases = new Set<string>();
  refreshable = new Set<string>();
  leaseAttempts = 0;
  failures = 0;

  async find(inputRoute: OwnedPlanningRouteRecord) {
    return this.profiles.get(inputRoute.coordinateHash) ?? null;
  }
  async tryAcquireLease(inputRoute: OwnedPlanningRouteRecord) {
    this.leaseAttempts += 1;
    if (this.leases.has(inputRoute.coordinateHash)) return false;
    if (
      this.profiles.has(inputRoute.coordinateHash) &&
      !this.refreshable.has(inputRoute.coordinateHash)
    ) {
      return false;
    }
    this.leases.add(inputRoute.coordinateHash);
    return true;
  }
  async save(
    inputRoute: OwnedPlanningRouteRecord,
    _holder: string,
    evidence: CanopyEvidenceProfile,
  ) {
    this.profiles.set(inputRoute.coordinateHash, evidence);
    this.refreshable.delete(inputRoute.coordinateHash);
  }
  async fail() {
    this.failures += 1;
  }
  async release(inputRoute: OwnedPlanningRouteRecord) {
    this.leases.delete(inputRoute.coordinateHash);
  }
}

describe('saved-route canopy preparation', () => {
  it('coalesces concurrent work under one preparation lease', async () => {
    const repository = new MemoryRepository();
    let finish!: (value: CanopyEvidenceProfile) => void;
    const prepare = vi.fn(
      () =>
        new Promise<CanopyEvidenceProfile>((resolve) => {
          finish = resolve;
        }),
    );
    const coordinator = new CanopyPreparationCoordinator(repository, { prepare });

    const first = coordinator.prepareAndWait(route, 100);
    const second = coordinator.prepareAndWait(route, 100);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    finish(profile());

    await expect(Promise.all([first, second])).resolves.toEqual([profile(), profile()]);
    expect(repository.leaseAttempts).toBe(1);
  });

  it('invalidates the cache when the coordinate hash changes', async () => {
    const repository = new MemoryRepository();
    const prepare: RouteCanopyPreparer['prepare'] = vi.fn(async (inputRoute) =>
      profile(inputRoute),
    );
    const coordinator = new CanopyPreparationCoordinator(repository, { prepare });
    const changedRoute = {
      ...route,
      coordinateHash: 'geometry-b',
      planningRoute: adaptLegacyRoute(route.route),
    };

    await coordinator.prepareAndWait(route, 100);
    await coordinator.prepareAndWait(changedRoute, 200);

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(await repository.find(route)).toMatchObject({ coordinateHash: 'geometry-a' });
    expect(await repository.find(changedRoute)).toMatchObject({ coordinateHash: 'geometry-b' });
  });

  it('keeps a last valid profile available when refresh fails', async () => {
    const repository = new MemoryRepository();
    repository.profiles.set(route.coordinateHash, profile());
    repository.refreshable.add(route.coordinateHash);
    const coordinator = new CanopyPreparationCoordinator(repository, {
      prepare: async () => {
        throw new Error('provider unavailable');
      },
    });

    await expect(coordinator.prepareAndWait(route, 100)).resolves.toEqual(profile());
    expect(repository.failures).toBe(1);
  });
});

describe('canopy preparation lifecycle', () => {
  it('contains acquisition failures without trying to release an unowned lease', async () => {
    const repository = new MemoryRepository();
    vi.spyOn(repository, 'tryAcquireLease').mockRejectedValue(new Error('database unavailable'));
    const release = vi.spyOn(repository, 'release');
    const prepare = vi.fn(async () => profile());
    const coordinator = new CanopyPreparationCoordinator(repository, { prepare });
    coordinator.start(route, 100);
    await expect(coordinator.close()).resolves.toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('contains failure persistence and release failures and preserves cached evidence', async () => {
    const repository = new MemoryRepository();
    repository.profiles.set(route.coordinateHash, profile());
    repository.refreshable.add(route.coordinateHash);
    vi.spyOn(repository, 'fail').mockRejectedValue(new Error('failure persistence unavailable'));
    const release = vi
      .spyOn(repository, 'release')
      .mockRejectedValue(new Error('release unavailable'));
    const coordinator = new CanopyPreparationCoordinator(repository, {
      prepare: async () => {
        throw new Error('provider unavailable');
      },
    });
    await expect(coordinator.prepareAndWait(route, 100)).resolves.toEqual(profile());
    expect(release).toHaveBeenCalledOnce();
    await expect(coordinator.close()).resolves.toBe(true);
  });

  it('discards late evidence and refuses preparation after the shutdown deadline', async () => {
    const repository = new MemoryRepository();
    const save = vi.spyOn(repository, 'save');
    const release = vi.spyOn(repository, 'release');
    let finish!: (value: CanopyEvidenceProfile) => void;
    const prepare = vi.fn(
      () =>
        new Promise<CanopyEvidenceProfile>((resolve) => {
          finish = resolve;
        }),
    );
    const coordinator = new CanopyPreparationCoordinator(repository, { prepare });
    const work = coordinator.prepareAndWait(route, 100);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await expect(coordinator.close(1)).resolves.toBe(false);
    finish(profile());
    await expect(work).resolves.toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    await expect(coordinator.prepareAndWait(route, 200)).resolves.toBeNull();
  });
});
