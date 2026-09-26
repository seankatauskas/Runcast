import { planningPositionAt } from './timing';
import { cumulativeDistances, haversine } from '../geo';
import { contentIdentity } from './identity';
import type { NormalizedRouteForecast, PlanningRoute, WoodlandEvidenceProfile } from './types';

export function reversePlanningRoute(route: PlanningRoute): PlanningRoute {
  const points = [...route.part.points].reverse();
  const cumulativeDistanceM = cumulativeDistances(points);
  return {
    ...route,
    part: { points },
    cumulativeDistanceM,
    totalDistanceM: cumulativeDistanceM.at(-1) ?? 0,
  };
}

export function reverseNormalizedRouteForecast(
  forecast: NormalizedRouteForecast,
  totalDistanceM: number,
): NormalizedRouteForecast {
  const withoutHash = {
    ...forecast,
    anchors: forecast.anchors
      .map((anchor) => ({
        ...anchor,
        routeDistanceM: totalDistanceM - anchor.routeDistanceM,
      }))
      .sort((left, right) => left.routeDistanceM - right.routeDistanceM),
    contentHash: undefined,
  };
  const { contentHash: _ignored, ...identityBody } = withoutHash;
  return { ...identityBody, contentHash: contentIdentity(identityBody) };
}

export function reverseWoodlandEvidenceProfile(
  woodlandEvidence: WoodlandEvidenceProfile,
  totalDistanceM: number,
): WoodlandEvidenceProfile {
  const valueAt = (distanceM: number) =>
    woodlandEvidence.values[
      Math.min(
        Math.max(Math.round(distanceM / woodlandEvidence.resolutionM), 0),
        woodlandEvidence.values.length - 1,
      )
    ];
  return {
    ...woodlandEvidence,
    values: woodlandEvidence.values.map((_, index) =>
      valueAt(Math.max(totalDistanceM - index * woodlandEvidence.resolutionM, 0)),
    ),
  };
}

export function planningRouteIsOutAndBack(route: PlanningRoute, toleranceM = 30): boolean {
  if (route.part.points.length < 2 || route.totalDistanceM <= 0) return false;
  const probes = 32;
  let hits = 0;
  for (let i = 1; i <= probes; i++) {
    const fraction = i / (2 * (probes + 1));
    const a = planningPositionAt(route, fraction * route.totalDistanceM).position;
    const b = planningPositionAt(route, (1 - fraction) * route.totalDistanceM).position;
    if (haversine(a, b) < toleranceM) hits++;
  }
  return hits >= probes * 0.9;
}

export function playbackDistanceAtTime(
  samples: readonly { time: number; distanceM: number }[],
  time: number,
): number {
  if (!samples.length || !Number.isFinite(time)) return 0;
  if (time <= samples[0].time) return samples[0].distanceM;
  const last = samples.at(-1)!;
  if (time >= last.time) return last.distanceM;
  const upperIndex = samples.findIndex((sample) => sample.time >= time);
  const lower = samples[upperIndex - 1];
  const upper = samples[upperIndex];
  const fraction = (time - lower.time) / (upper.time - lower.time);
  return lower.distanceM + (upper.distanceM - lower.distanceM) * fraction;
}
