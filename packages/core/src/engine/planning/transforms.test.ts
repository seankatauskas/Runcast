import { describe, expect, it } from 'vitest';
import { makeValidWeatherPayload, WEATHER_FIXTURE_T0 } from '../../test-fixtures/weather-fixtures';
import { contentIdentity } from './identity';
import { parsePlanningGpx } from './gpx';
import { evaluateRunWithProfile } from './pipeline';
import { normalizeOpenMeteoForecast } from './weather';
import { planningPositionAt } from './timing';
import {
  reverseNormalizedRouteForecast,
  reversePlanningRoute,
  reverseWoodlandEvidenceProfile,
} from './transforms';
import type { WoodlandEvidenceProfile } from './types';

const route = parsePlanningGpx(
  '<gpx><rte><rtept lat="41.9" lon="-87.6"><ele>180</ele></rtept><rtept lat="41.918" lon="-87.6"><ele>180</ele></rtept></rte></gpx>',
  'north',
  'North line',
);
function steadyForecast() {
  const payloads = route.part.points.map((point, index) => {
    const payload = makeValidWeatherPayload();
    payload.latitude = point.lat;
    payload.longitude = point.lon;
    const steady = (value: number) => payload.hourly.time.map(() => value);
    Object.assign(payload.hourly, {
      temperature_2m: steady(index ? 20 : 10),
      apparent_temperature: steady(index ? 20 : 10),
      wind_speed_10m: steady(5),
      wind_direction_10m: steady(0),
      wind_gusts_10m: steady(7),
      precipitation_probability: steady(0),
      precipitation: steady(0),
      weather_code: steady(1),
    });
    return payload;
  });
  return normalizeOpenMeteoForecast(
    payloads,
    route.part.points.map((point, index) => ({
      lat: point.lat,
      lon: point.lon,
      routeDistanceM: route.cumulativeDistanceM[index],
    })),
    { fetchId: 'reversal', fetchedAt: WEATHER_FIXTURE_T0 },
  );
}
function woodland(total: number): WoodlandEvidenceProfile {
  return {
    schemaVersion: 2,
    values: Array.from({ length: Math.round(total / 50) + 1 }, () => 'no-mapped-woodland' as const),
    resolutionM: 50,
    source: 'fixture',
    fetchedAt: null,
    parserVersion: 'fixture',
    completeness: 'complete',
    confidence: 1,
    reasons: [],
  };
}

describe('current planning reversal', () => {
  it('reverses route and forecast together: geographic weather stays put while V3 headwind becomes tailwind', () => {
    const forecast = steadyForecast();
    const coverage = woodland(route.totalDistanceM);
    const reversedRoute = reversePlanningRoute(route);
    const reversedForecast = reverseNormalizedRouteForecast(forecast, route.totalDistanceM);
    const forward = evaluateRunWithProfile({
      route,
      forecast,
      woodlandEvidence: coverage,
      startTime: WEATHER_FIXTURE_T0 + 600_000,
      expectedFlatSpeedMs: 3,
      canopyModelMode: 'off',
    });
    const backward = evaluateRunWithProfile({
      route: reversedRoute,
      forecast: reversedForecast,
      woodlandEvidence: reverseWoodlandEvidenceProfile(coverage, route.totalDistanceM),
      startTime: WEATHER_FIXTURE_T0 + 600_000,
      expectedFlatSpeedMs: 3,
      canopyModelMode: 'off',
    });
    expect(forward.assessment.plan?.schemaVersion).toBe(3);
    expect(backward.assessment.plan?.schemaVersion).toBe(3);
    expect(forward.profile!.samples[0].ambientHeadwindMs).toBeCloseTo(5, 6);
    expect(backward.profile!.samples[0].ambientHeadwindMs).toBeCloseTo(-5, 6);
    expect(forward.profile!.samples[0].airTemperatureC).toBeCloseTo(
      backward.profile!.samples.at(-1)!.airTemperatureC,
      6,
    );
    expect(forward.profile!.samples.at(-1)!.airTemperatureC).toBeCloseTo(
      backward.profile!.samples[0].airTemperatureC,
      6,
    );
    expect(backward.profile!.durationSeconds).toBeCloseTo(forward.profile!.durationSeconds, 6);
    expect(backward.assessment.plan!.physicalConditions.meanAerodynamicOpposition).toBeLessThan(
      forward.assessment.plan!.physicalConditions.meanAerodynamicOpposition,
    );
    const { contentHash, ...identity } = reversedForecast;
    expect(contentHash).toBe(contentIdentity(identity));
    expect(contentHash).not.toBe(forecast.contentHash);
    for (const fraction of [0, 0.1, 0.5, 0.9, 1]) {
      expect(
        planningPositionAt(reversedRoute, fraction * route.totalDistanceM).position.lat,
      ).toBeCloseTo(
        planningPositionAt(route, (1 - fraction) * route.totalDistanceM).position.lat,
        9,
      );
    }
  });

  it('mirrors woodland buckets correctly when route length is not a multiple of resolution', () => {
    const total = 1030;
    const profile = woodland(total);
    profile.values = profile.values.map((_, index) =>
      index % 3 === 0 ? 'mapped-woodland' : index % 3 === 1 ? 'no-mapped-woodland' : 'unknown',
    );
    const reversed = reverseWoodlandEvidenceProfile(profile, total);
    for (let index = 0; index < profile.values.length; index++) {
      const originalIndex = Math.min(
        Math.max(Math.round((total - index * profile.resolutionM) / profile.resolutionM), 0),
        profile.values.length - 1,
      );
      expect(reversed.values[index]).toBe(profile.values[originalIndex]);
    }
  });
});
