import type { RouteOrigin } from '@runcast/contracts';
import {
  adaptLegacyRoute,
  adaptPlannableRouteV1,
  DEMO_ROUTES,
  routeGeometryIdentity,
  type CoverageMask,
  type CanopyEvidenceProfile,
  type PlanningRoute,
  type Route,
  type WoodlandEvidenceProfile,
} from '@runcast/core';
import type { CachedCloudRoute } from './cloudRoutes';
import type { CachedPlanningBundle } from './planningBundle';
import type { PlanningBundleSyncState } from './planningBundleSync';
import type { StoredLocalRoute } from './routeLibrary';
import {
  legacyCoverageAsWoodlandEvidence,
  woodlandEvidenceForLegacyPresentation,
} from './compatibility/legacyPlanningAdapters';

export interface RouteEntry {
  legacyRoute: Route;
  legacyCoverage: CoverageMask;
  planningRoute: PlanningRoute;
  woodlandEvidence: WoodlandEvidenceProfile;
  canopyEvidence: CanopyEvidenceProfile | null;
  isDemo: boolean;
  origin: RouteOrigin;
  geometryIdentity: string;
  createdAt: number;
  updatedAt: number;
  remoteVersion: number | null;
  originalGpx: string | null;
  timezone: string | null;
  planningBundle: CachedPlanningBundle | null;
  planningSyncState: PlanningBundleSyncState | null;
}

function localRouteEntry(stored: StoredLocalRoute): RouteEntry {
  return {
    legacyRoute: stored.legacyRoute,
    legacyCoverage: stored.legacyCoverage,
    planningRoute: stored.planningRoute,
    woodlandEvidence: stored.woodlandEvidence,
    canopyEvidence: null,
    isDemo: false,
    origin: 'local',
    geometryIdentity: stored.geometryIdentity,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    remoteVersion: null,
    originalGpx: stored.originalGpx,
    timezone: null,
    planningBundle: null,
    planningSyncState: null,
  };
}

function cloudRouteEntry(cached: CachedCloudRoute): RouteEntry {
  const planning = cached.content.kind === 'planning' ? cached.content.planning : null;
  const route =
    cached.content.kind === 'route'
      ? cached.content.route.data
      : cached.content.planning.bundle.route.data;
  const planningRoute = { ...route, name: cached.summary.name } as PlanningRoute;
  return {
    legacyRoute: adaptPlannableRouteV1(planningRoute),
    planningRoute,
    legacyCoverage: woodlandEvidenceForLegacyPresentation(
      (cached.content.kind === 'route'
        ? cached.content.woodlandEvidence
        : cached.content.planning.bundle.environment.coverage) as WoodlandEvidenceProfile,
    ),
    woodlandEvidence: (cached.content.kind === 'route'
      ? cached.content.woodlandEvidence
      : cached.content.planning.bundle.environment.coverage) as WoodlandEvidenceProfile,
    canopyEvidence: planning ? (planning.bundle.environment.canopy as CanopyEvidenceProfile) : null,
    isDemo: false,
    origin: cached.summary.origin,
    geometryIdentity: cached.summary.geometryIdentity,
    createdAt: Date.parse(cached.summary.createdAt),
    updatedAt: Date.parse(cached.summary.updatedAt),
    remoteVersion: cached.summary.version,
    originalGpx: null,
    timezone: cached.timezone,
    planningBundle: planning,
    planningSyncState: cached.syncState,
  };
}

export interface PlannerRoutesState {
  routes: RouteEntry[];
  selectedId: string;
  reversedIds: ReadonlySet<string>;
  ownerId: string | null;
  revision: number;
  editedAt: Readonly<Record<string, number>>;
  deletedAt: Readonly<Record<string, number>>;
}

export function initialPlannerRoutes(): PlannerRoutesState {
  const routes = DEMO_ROUTES.map((demo): RouteEntry => {
    const planningRoute = adaptLegacyRoute(demo.route);
    return {
      legacyRoute: demo.route,
      legacyCoverage: demo.coverage,
      planningRoute,
      woodlandEvidence: legacyCoverageAsWoodlandEvidence(demo.coverage, 'bundled-demo-v1'),
      canopyEvidence: demo.canopyEvidence,
      isDemo: true,
      origin: 'demo',
      geometryIdentity: routeGeometryIdentity(planningRoute),
      createdAt: 0,
      updatedAt: 0,
      remoteVersion: null,
      originalGpx: null,
      timezone: null,
      planningBundle: null,
      planningSyncState: null,
    };
  });
  return {
    routes,
    selectedId: routes[0].legacyRoute.id,
    reversedIds: new Set(),
    ownerId: null,
    revision: 0,
    editedAt: {},
    deletedAt: {},
  };
}

export type PlannerRoutesAction =
  | {
      type: 'hydrate';
      routes: StoredLocalRoute[];
      startedAtRevision: number;
      ownerId: string | null;
    }
  | { type: 'import'; route: StoredLocalRoute }
  | { type: 'rename'; id: string; name: string; now: number }
  | { type: 'delete'; id: string }
  | {
      type: 'environment';
      id: string;
      geometryIdentity: string;
      woodlandEvidence: WoodlandEvidenceProfile;
      now: number;
    }
  | { type: 'cloud'; routes: CachedCloudRoute[]; ownerId: string | null }
  | { type: 'select'; id: string }
  | { type: 'reverse'; id: string };

function withRoutes(state: PlannerRoutesState, routes: RouteEntry[]): PlannerRoutesState {
  const ids = new Set(routes.map((route) => route.legacyRoute.id));
  return {
    ...state,
    routes,
    selectedId: ids.has(state.selectedId)
      ? state.selectedId
      : routes.find((route) => route.isDemo)!.legacyRoute.id,
    reversedIds: new Set([...state.reversedIds].filter((id) => ids.has(id))),
  };
}

export function plannerRoutesReducer(
  state: PlannerRoutesState,
  action: PlannerRoutesAction,
): PlannerRoutesState {
  if (action.type === 'select')
    return state.routes.some((route) => route.legacyRoute.id === action.id)
      ? { ...state, selectedId: action.id }
      : state;
  if (action.type === 'reverse') {
    if (!state.routes.some((route) => route.legacyRoute.id === action.id)) return state;
    const reversedIds = new Set(state.reversedIds);
    if (reversedIds.has(action.id)) reversedIds.delete(action.id);
    else reversedIds.add(action.id);
    return { ...state, reversedIds };
  }
  if (action.type === 'hydrate') {
    if (action.ownerId !== state.ownerId) return state;
    const cloudGeometry = new Set(
      state.routes
        .filter((route) => route.origin.startsWith('cloud-'))
        .map((route) => route.geometryIdentity),
    );
    const current = new Map(
      state.routes
        .filter((route) => route.origin === 'local')
        .map((route) => [route.legacyRoute.id, route]),
    );
    const loaded = new Map<string, RouteEntry>();
    for (const stored of action.routes) {
      if (
        (state.deletedAt[stored.id] ?? -1) > action.startedAtRevision ||
        cloudGeometry.has(stored.geometryIdentity)
      )
        continue;
      const newer = (state.editedAt[stored.id] ?? -1) > action.startedAtRevision;
      const entry = newer ? current.get(stored.id) : localRouteEntry(stored);
      if (entry) loaded.set(stored.id, entry);
    }
    for (const [id, entry] of current) {
      if (
        (state.editedAt[id] ?? -1) > action.startedAtRevision &&
        !cloudGeometry.has(entry.geometryIdentity)
      )
        loaded.set(id, entry);
    }
    return withRoutes(state, [
      ...state.routes.filter((route) => route.origin !== 'local'),
      ...loaded.values(),
    ]);
  }
  if (action.type === 'cloud') {
    const incoming = action.routes.filter(
      (route) => route.userId === action.ownerId && !state.deletedAt[route.summary.id],
    );
    const geometry = new Set(incoming.map((route) => route.summary.geometryIdentity));
    const routes = [
      ...state.routes.filter(
        (route) =>
          !route.origin.startsWith('cloud-') &&
          (route.isDemo || !geometry.has(route.geometryIdentity)),
      ),
      ...incoming.map(cloudRouteEntry),
    ];
    return withRoutes({ ...state, ownerId: action.ownerId }, routes);
  }
  const revision = state.revision + 1;
  if (action.type === 'import') {
    const duplicate = state.routes.find(
      (route) =>
        route.legacyRoute.id !== action.route.id &&
        route.geometryIdentity === action.route.geometryIdentity,
    );
    if (duplicate) return { ...state, selectedId: duplicate.legacyRoute.id };
    const entry = localRouteEntry(action.route);
    const deletedAt = { ...state.deletedAt };
    delete deletedAt[action.route.id];
    return withRoutes(
      {
        ...state,
        revision,
        selectedId: action.route.id,
        deletedAt,
        editedAt: { ...state.editedAt, [action.route.id]: revision },
      },
      [...state.routes.filter((route) => route.legacyRoute.id !== action.route.id), entry],
    );
  }
  if (action.type === 'delete')
    return withRoutes(
      {
        ...state,
        revision,
        deletedAt: { ...state.deletedAt, [action.id]: revision },
        editedAt: { ...state.editedAt, [action.id]: revision },
      },
      state.routes.filter((route) => route.legacyRoute.id !== action.id),
    );
  if (action.type === 'environment') {
    return withRoutes(
      { ...state, revision, editedAt: { ...state.editedAt, [action.id]: revision } },
      state.routes.map((route) =>
        route.origin === 'local' &&
        route.legacyRoute.id === action.id &&
        route.geometryIdentity === action.geometryIdentity
          ? {
              ...route,
              woodlandEvidence: action.woodlandEvidence,
              legacyCoverage: woodlandEvidenceForLegacyPresentation(action.woodlandEvidence),
              updatedAt: action.now,
            }
          : route,
      ),
    );
  }
  return withRoutes(
    { ...state, revision, editedAt: { ...state.editedAt, [action.id]: revision } },
    state.routes.map((route) =>
      route.legacyRoute.id === action.id
        ? {
            ...route,
            legacyRoute: { ...route.legacyRoute, name: action.name },
            planningRoute: { ...route.planningRoute, name: action.name },
            updatedAt: action.now,
          }
        : route,
    ),
  );
}
