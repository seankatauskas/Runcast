import { describe, expect, it } from 'vitest';
import {
  adaptPlannableRouteV1,
  routeGeometryIdentity,
  type PlanningRoute,
  type WoodlandEvidenceProfile,
} from '@runcast/core';
import { initialPlannerRoutes, plannerRoutesReducer } from './plannerRoutes';
import { woodlandEvidenceForLegacyPresentation } from './compatibility/legacyPlanningAdapters';
import type { StoredLocalRoute } from './routeLibrary';
import type { CachedCloudRoute } from './cloudRoutes';
import { fixtureBundleV3, NOW } from './planningBundle.fixtures';
const bundle = fixtureBundleV3();
function local(id = 'local-1', name = 'Original'): StoredLocalRoute {
  const planningRoute = { ...bundle.route.data, id, name } as PlanningRoute;
  const woodlandEvidence = bundle.environment.coverage as WoodlandEvidenceProfile;
  return {
    id,
    name,
    originalGpx: '<gpx/>',
    geometryIdentity: routeGeometryIdentity(planningRoute),
    planningRoute,
    legacyRoute: adaptPlannableRouteV1(planningRoute),
    legacyCoverage: woodlandEvidenceForLegacyPresentation(woodlandEvidence),
    woodlandEvidence,
    origin: 'local',
    createdAt: NOW,
    updatedAt: NOW,
  };
}
function cloud(planning = false): CachedCloudRoute {
  return {
    userId: 'alice',
    timezone: 'America/Chicago',
    syncState: planning ? 'modified' : 'preparing',
    summary: {
      id: bundle.route.data.id,
      name: 'Server rename',
      source: 'gpx',
      origin: 'cloud-gpx',
      providerId: null,
      geometryIdentity: local().geometryIdentity,
      distance: 1000,
      importStatus: 'ready',
      version: 2,
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    },
    content: planning
      ? {
          kind: 'planning',
          planning: {
            userId: 'alice',
            routeId: bundle.route.data.id,
            body: JSON.stringify(bundle),
            bundle,
            etag: 'v3',
            installedAt: NOW,
          },
        }
      : { kind: 'route', route: bundle.route, woodlandEvidence: bundle.environment.coverage },
  };
}
const selected = (state: ReturnType<typeof initialPlannerRoutes>) =>
  state.routes.find((route) => route.legacyRoute.id === state.selectedId)!;
describe('planner route ownership', () => {
  it('preserves imports and renames made during a slow device read', () => {
    let state = plannerRoutesReducer(initialPlannerRoutes(), { type: 'import', route: local() });
    state = plannerRoutesReducer(state, {
      type: 'rename',
      id: 'local-1',
      name: 'New name',
      now: NOW + 1,
    });
    state = plannerRoutesReducer(state, {
      type: 'hydrate',
      routes: [local()],
      startedAtRevision: 0,
      ownerId: null,
    });
    expect(selected(state).planningRoute.name).toBe('New name');
    state = plannerRoutesReducer(state, {
      type: 'hydrate',
      routes: [],
      startedAtRevision: 0,
      ownerId: null,
    });
    expect(selected(state).planningRoute.name).toBe('New name');
  });
  it('does not resurrect deleted routes, and cleans selection and reversal', () => {
    let state = plannerRoutesReducer(initialPlannerRoutes(), { type: 'import', route: local() });
    state = plannerRoutesReducer(state, { type: 'reverse', id: 'local-1' });
    state = plannerRoutesReducer(state, { type: 'delete', id: 'local-1' });
    state = plannerRoutesReducer(state, {
      type: 'hydrate',
      routes: [local()],
      startedAtRevision: 1,
      ownerId: null,
    });
    expect(state.routes.some((route) => route.legacyRoute.id === 'local-1')).toBe(false);
    expect(state.reversedIds.size).toBe(0);
    expect(selected(state).isDemo).toBe(true);
    expect(plannerRoutesReducer(state, { type: 'reverse', id: 'absent' })).toBe(state);
  });
  it('promotes local geometry atomically and ignores stale hydration and environment work', () => {
    let state = plannerRoutesReducer(initialPlannerRoutes(), { type: 'import', route: local() });
    state = plannerRoutesReducer(state, { type: 'cloud', routes: [cloud()], ownerId: 'alice' });
    state = plannerRoutesReducer(state, {
      type: 'hydrate',
      routes: [local()],
      startedAtRevision: 0,
      ownerId: null,
    });
    state = plannerRoutesReducer(state, {
      type: 'environment',
      id: 'local-1',
      geometryIdentity: local().geometryIdentity,
      woodlandEvidence: { ...local().woodlandEvidence, source: 'late' },
      now: NOW + 1,
    });
    expect(
      state.routes.filter((route) => route.geometryIdentity === local().geometryIdentity),
    ).toHaveLength(1);
    const entry = state.routes.find((route) => route.origin === 'cloud-gpx')!;
    expect(entry.timezone).toBe('America/Chicago');
    expect(entry.planningRoute.name).toBe('Server rename');
    expect(entry.planningBundle).toBeNull();
    expect(entry.woodlandEvidence.source).not.toBe('late');
    state = plannerRoutesReducer(state, { type: 'cloud', routes: [cloud(true)], ownerId: 'alice' });
    expect(state.routes.find((route) => route.origin === 'cloud-gpx')?.planningBundle?.bundle).toBe(
      bundle,
    );
  });
  it('clears foreign snapshots on account changes without removing demos', () => {
    let state = plannerRoutesReducer(initialPlannerRoutes(), {
      type: 'cloud',
      routes: [cloud(true)],
      ownerId: 'alice',
    });
    state = plannerRoutesReducer(state, { type: 'cloud', routes: [cloud(true)], ownerId: 'bob' });
    expect(state.routes.every((route) => route.isDemo)).toBe(true);
    expect(state.routes.length).toBe(initialPlannerRoutes().routes.length);
    const unchanged = plannerRoutesReducer(state, {
      type: 'hydrate',
      routes: [local()],
      startedAtRevision: 0,
      ownerId: 'alice',
    });
    expect(unchanged).toBe(state);
  });
  it('does not append a late local import after the same geometry becomes cloud owned', () => {
    let state = plannerRoutesReducer(initialPlannerRoutes(), {
      type: 'cloud',
      routes: [cloud()],
      ownerId: 'alice',
    });
    state = plannerRoutesReducer(state, { type: 'import', route: local() });
    expect(selected(state).origin).toBe('cloud-gpx');
    expect(
      state.routes.filter((route) => route.geometryIdentity === local().geometryIdentity),
    ).toHaveLength(1);
  });
});
