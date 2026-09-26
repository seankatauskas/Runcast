import {
  contentIdentity,
  parsePlanningGpx,
  type NormalizedRouteForecast,
  type WoodlandEvidenceProfile,
} from '@runcast/core';
import { describe, expect, it } from 'vitest';
import { adaptPlannableRouteV1 } from '@runcast/core';
import {
  reverseNormalizedRouteForecast,
  reversePlanningRoute,
  reverseWoodlandEvidenceProfile,
} from '@runcast/core';

describe('mobile planning route and environment transforms', () => {
  it('retains guest missing-elevation quality while adapting only the legacy display shape', () => {
    const planningRoute = parsePlanningGpx(
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"/><trkpt lat="41.01" lon="-87.01"><ele>0</ele></trkpt></trkseg></trk></gpx>',
      'guest',
      'Guest',
    );
    const display = adaptPlannableRouteV1(planningRoute);
    expect(planningRoute.quality.elevationStatus).toBe('partial');
    expect(planningRoute.part.points.map((point) => point.elevationM)).toEqual([null, 0]);
    expect(display.points.map((point) => point.ele)).toEqual([0, 0]);
  });

  it('reverses nullable route points and recomputes cumulative distance', () => {
    const route = parsePlanningGpx(
      '<gpx><rte><rtept lat="41" lon="-87"><ele>1</ele></rtept><rtept lat="41.01" lon="-87.01"><ele>2</ele></rtept><rtept lat="41.02" lon="-87.02"><ele>3</ele></rtept></rte></gpx>',
      'route',
      'Route',
    );
    const reversed = reversePlanningRoute(route);
    expect(reversed.part.points.map((point) => point.elevationM)).toEqual([3, 2, 1]);
    expect(reversed.cumulativeDistanceM[0]).toBe(0);
    expect(reversed.totalDistanceM).toBeCloseTo(route.totalDistanceM, 6);
  });

  it('reverses forecast anchors with a fresh identity and coverage samples', () => {
    const body = {
      schemaVersion: 2 as const,
      normalizationVersion: 'fixture',
      provider: 'fixture',
      providerModel: null,
      providerRun: null,
      fetchId: 'fixture',
      fetchedAt: 1,
      validFrom: 1,
      validUntil: 2,
      requestedCoordinates: [{ lat: 0, lon: 0 }],
      returnedCoordinates: [{ lat: 0, lon: 0 }],
      variables: {} as NormalizedRouteForecast['variables'],
      anchors: [
        { lat: 0, lon: 0, routeDistanceM: 0, hourly: { time: [1, 2], values: {} } },
        { lat: 1, lon: 1, routeDistanceM: 100, hourly: { time: [1, 2], values: {} } },
      ] as NormalizedRouteForecast['anchors'],
      missingCounts: {} as NormalizedRouteForecast['missingCounts'],
      reasons: [],
    };
    const forecast = { ...body, contentHash: contentIdentity(body) };
    const reversedForecast = reverseNormalizedRouteForecast(forecast, 100);
    expect(reversedForecast.anchors.map((anchor) => [anchor.lat, anchor.routeDistanceM])).toEqual([
      [1, 0],
      [0, 100],
    ]);
    const { contentHash, ...identityBody } = reversedForecast;
    expect(contentHash).toBe(contentIdentity(identityBody));

    const woodlandEvidence: WoodlandEvidenceProfile = {
      schemaVersion: 2,
      values: ['mapped-woodland', 'unknown', 'no-mapped-woodland'],
      resolutionM: 50,
      source: 'fixture',
      fetchedAt: null,
      parserVersion: 'fixture',
      completeness: 'partial',
      confidence: null,
      reasons: [],
    };
    expect(reverseWoodlandEvidenceProfile(woodlandEvidence, 100).values).toEqual([
      'no-mapped-woodland',
      'unknown',
      'mapped-woodland',
    ]);
  });
});
