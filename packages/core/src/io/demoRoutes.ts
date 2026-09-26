/** Bundled city demo routes. The GPX files go through the app's own parser. */
import { parseGpx } from '../engine/gpx';
import { adaptLegacyRoute } from '../engine/planning/gpx';
import { routeGeometryIdentity } from '../engine/planning/identity';
import { unknownMask } from './overpass';
import type { CoverageMask, Route } from '../engine/types';
import type { CanopyEvidenceProfile } from '../engine/planning/types';
import centralParkLoopGpx from '../data/centralParkLoopGpx';
import chicagoLakefrontTrailGpx from '../data/chicagoLakefrontTrailGpx';
import griffithParkHollywoodSignBronsonGpx from '../data/griffithParkHollywoodSignBronsonGpx';
import presidioCoastalTrailGpx from '../data/presidioCoastalTrailGpx';
import centralParkLoopCanopy from '../data/central-park-loop.canopy-v3.json';
import chicagoLakefrontTrailCanopy from '../data/chicago-lakefront-trail.canopy-v3.json';
import griffithParkHollywoodSignBronsonCanopy from '../data/griffith-park-hollywood-sign-bronson.canopy-v3.json';
import presidioCoastalTrailCanopy from '../data/presidio-coastal-trail.canopy-v3.json';

export interface DemoRoute {
  route: Route;
  coverage: CoverageMask;
  canopyEvidence: CanopyEvidenceProfile;
}

export function checkedCanopySidecar(route: Route, sidecar: unknown): CanopyEvidenceProfile {
  if (!sidecar || typeof sidecar !== 'object') {
    throw new Error(`Stale or invalid canopy sidecar for demo route ${route.id}`);
  }
  const profile = sidecar as CanopyEvidenceProfile;
  if (
    !Array.isArray(profile.routeDistanceM) ||
    !Array.isArray(profile.canopyPct) ||
    !Array.isArray(profile.standardErrorPct)
  ) {
    throw new Error(`Stale or invalid canopy sidecar for demo route ${route.id}`);
  }
  const valuesAreValid = profile.routeDistanceM.every((distanceM, index) => {
    const canopyPct = profile.canopyPct?.[index];
    const standardErrorPct = profile.standardErrorPct?.[index];
    return (
      Number.isFinite(distanceM) &&
      distanceM >= 0 &&
      (index === 0 ? distanceM === 0 : distanceM > profile.routeDistanceM[index - 1]) &&
      (canopyPct === null || (Number.isFinite(canopyPct) && canopyPct >= 0 && canopyPct <= 100)) &&
      (standardErrorPct === null ||
        (Number.isFinite(standardErrorPct) && standardErrorPct >= 0 && standardErrorPct <= 100)) &&
      (canopyPct === null) === (standardErrorPct === null)
    );
  });
  if (
    profile.schemaVersion !== 3 ||
    profile.datasetYear !== 2025 ||
    profile.datasetVersion !== 'v2025-6' ||
    profile.coordinateHash !== routeGeometryIdentity(adaptLegacyRoute(route)) ||
    profile.routeDistanceM.length !== profile.canopyPct.length ||
    profile.routeDistanceM.length !== profile.standardErrorPct.length ||
    profile.routeDistanceM.length === 0 ||
    Math.abs(profile.routeDistanceM.at(-1)! - route.totalDistance) > 0.01 ||
    !valuesAreValid
  ) {
    throw new Error(`Stale or invalid canopy sidecar for demo route ${route.id}`);
  }
  return profile;
}

const cityDemo = (gpx: string, id: string, name: string, sidecar: unknown): DemoRoute => {
  const route = { ...parseGpx(gpx, id, name), name };
  return {
    route,
    coverage: unknownMask(route) as CoverageMask,
    canopyEvidence: checkedCanopySidecar(route, sidecar),
  };
};

export const DEMO_ROUTES: DemoRoute[] = [
  cityDemo(centralParkLoopGpx, 'central-park-loop', 'Central Park Loop', centralParkLoopCanopy),
  cityDemo(
    chicagoLakefrontTrailGpx,
    'chicago-lakefront-trail',
    'Lakefront Trail',
    chicagoLakefrontTrailCanopy,
  ),
  cityDemo(
    griffithParkHollywoodSignBronsonGpx,
    'griffith-park-hollywood-sign-bronson',
    'Griffith Park',
    griffithParkHollywoodSignBronsonCanopy,
  ),
  cityDemo(
    presidioCoastalTrailGpx,
    'presidio-coastal-trail',
    'Presidio Trail',
    presidioCoastalTrailCanopy,
  ),
];
