import { parsePlanningGpx, PlanningGpxParseError } from './planning/gpx';
import type { PlanningRoute } from './planning/types';
import type { Route } from './types';

/** V1 error adapter retained for existing callers. */
export class GpxParseError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GpxParseError';
  }
}

/** Explicit V1 read/presentation adapter; null elevation remains V2-only. */
export function adaptPlannableRouteV1(route: PlanningRoute): Route {
  return {
    id: route.id,
    name: route.name,
    points: route.part.points.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      ele: point.elevationM ?? 0,
    })),
    cumulative: route.cumulativeDistanceM,
    totalDistance: route.totalDistanceM,
  };
}

/**
 * V1 compatibility adapter. Parsing and limits are V2-strict; nullable V2
 * elevation is converted to the historical V1 zero sentinel only here.
 */
export function parseGpx(xml: string, id: string, fallbackName: string): Route {
  try {
    return adaptPlannableRouteV1(parsePlanningGpx(xml, id, fallbackName));
  } catch (error) {
    if (error instanceof PlanningGpxParseError) {
      throw new GpxParseError(error.message, error.code, error.diagnostics);
    }
    throw error;
  }
}
