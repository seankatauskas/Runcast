import { describe, expect, it } from 'vitest';
import {
  makeValidWeatherPayload,
  WEATHER_FIXTURE_T0,
  type WeatherProviderPayloadFixture,
} from '../../test-fixtures/weather-fixtures';
import { parsePlanningGpx } from './gpx';
import { adaptLegacyRoute } from './gpx';
import { buildRouteConditionsProfile, evaluateRunV3, evaluateRunWithProfile } from './pipeline';
import type { CanopyEvidenceProfile, WoodlandEvidenceProfile } from './types';
import { normalizeOpenMeteoForecast, type RawOpenMeteoLocation } from './weather';
import { DEMO_ROUTES } from '../../io/demoRoutes';

const route = parsePlanningGpx(
  '<gpx><trk><trkseg><trkpt lat="41.9" lon="-87.6"><ele>180</ele></trkpt><trkpt lat="41.91" lon="-87.59"><ele>181</ele></trkpt></trkseg></trk></gpx>',
  'pipeline-route',
  'Pipeline route',
);
const woodlandEvidence: WoodlandEvidenceProfile = {
  schemaVersion: 2,
  values: ['mapped-woodland', 'no-mapped-woodland'],
  resolutionM: 50,
  source: 'fixture',
  fetchedAt: WEATHER_FIXTURE_T0,
  parserVersion: 'fixture-v2',
  completeness: 'complete',
  confidence: 1,
  reasons: [],
};
const canopyEvidence: CanopyEvidenceProfile = {
  schemaVersion: 3,
  routeDistanceM: [0, route.totalDistanceM],
  canopyPct: [75, 75],
  standardErrorPct: [5, 5],
  provider: 'fixture',
  region: 'conus',
  datasetYear: 2025,
  datasetVersion: 'v2025-6',
  sourceResolutionM: 30,
  acquiredAt: WEATHER_FIXTURE_T0,
  coordinateHash: 'fixture',
  completeness: 'complete',
  reasons: [],
};

function forecast(mutate?: (payload: WeatherProviderPayloadFixture) => void) {
  const payload = makeValidWeatherPayload();
  payload.hourly.precipitation_probability = [0, 0, 0, 0];
  payload.hourly.precipitation = [0, 0, 0, 0];
  payload.hourly.weather_code = [1, 1, 1, 1];
  mutate?.(payload);
  return normalizeOpenMeteoForecast(
    [payload as unknown as RawOpenMeteoLocation],
    [{ lat: 41.9, lon: -87.6, routeDistanceM: 0 }],
    { fetchId: 'pipeline-fixture', fetchedAt: WEATHER_FIXTURE_T0 },
  );
}

describe('evaluateRunV3 shared pipeline', () => {
  it('composes timing, weather, wind, solar, physical exposure, and fit deterministically', () => {
    const input = {
      route,
      forecast: forecast(),
      woodlandEvidence,
      startTime: WEATHER_FIXTURE_T0 + 10 * 60_000,
      expectedFlatSpeedMs: 3,
    };
    const first = evaluateRunV3(input);
    const second = evaluateRunV3(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      evaluable: true,
      safety: { tier: 'eligible' },
      plan: {
        timingQuality: 'grade-adjusted',
        exposureSummary: { mappedWoodlandFraction: 0.5, coverageCompleteness: 'complete' },
      },
    });
    expect(first.plan!.physicalConditions.directNormalRadiationDoseJm2).toBeGreaterThan(0);
    expect(first.plan!.physicalConditions.diffuseRadiationDoseJm2).toBeGreaterThan(0);
    const profile = buildRouteConditionsProfile(input);
    expect(profile.status).toBe('ok');
    if (profile.status !== 'ok') throw new Error('expected an evaluable route profile');
    expect(profile.profile.radiationDoseJm2).toBe(first.plan!.physicalConditions.radiationDoseJm2);
    expect(profile.profile.woodland).toEqual({
      mappedFraction: 0.5,
      completeness: 'complete',
      confidence: 1,
    });
    expect(profile.profile.samples[0]).toMatchObject({
      distanceM: 0,
      daylight: expect.any(Boolean),
      woodlandEvidence: 'mapped-woodland',
      airTemperatureC: expect.any(Number),
      feelsLikeC: expect.any(Number),
      radiationWm2: expect.any(Number),
      directNormalRadiationWm2: expect.any(Number),
      diffuseRadiationWm2: expect.any(Number),
      precipitationProbabilityPct: 0,
      gustMs: expect.any(Number),
      ambientWindSpeedMs: expect.any(Number),
      ambientHeadwindMs: expect.any(Number),
      ambientCrosswindMs: expect.any(Number),
      apparentAirflowMs: expect.any(Number),
      aerodynamicOppositionDelta: expect.any(Number),
    });
  });

  it('keeps measured radiation when overcast instead of converting clouds to zero sun', () => {
    const result = buildRouteConditionsProfile({
      route,
      forecast: forecast((payload) => {
        payload.hourly.cloud_cover = [100, 100, 100, 100];
        payload.hourly.shortwave_radiation = [300, 300, 300, 300];
      }),
      woodlandEvidence,
      startTime: WEATHER_FIXTURE_T0 + 10 * 60_000,
      expectedFlatSpeedMs: 3,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected an evaluable route profile');
    expect(result.profile.samples.every((sample) => sample.radiationWm2 === 300)).toBe(true);
    expect(result.profile.radiationDoseJm2).toBeGreaterThan(0);
  });

  it('hard-blocks thunder while retaining an evaluated physical plan', () => {
    const candidate = evaluateRunV3({
      route,
      forecast: forecast((payload) => {
        payload.hourly.weather_code = [95, 95, 95, 95];
      }),
      woodlandEvidence,
      startTime: WEATHER_FIXTURE_T0 + 10 * 60_000,
      expectedFlatSpeedMs: 3,
    });
    expect(candidate).toMatchObject({
      evaluable: true,
      safety: { tier: 'ineligible', reasons: ['safety.thunderstorm'] },
    });
  });

  it('abstains when a required provider value is null', () => {
    const candidate = evaluateRunV3({
      route,
      forecast: forecast((payload) => {
        payload.hourly.temperature_2m[0] = null;
      }),
      woodlandEvidence,
      startTime: WEATHER_FIXTURE_T0 + 10 * 60_000,
      expectedFlatSpeedMs: 3,
    });
    expect(candidate.evaluable).toBe(false);
    expect(candidate.reasons).toContain('weather.missing-critical-field:temperatureC');
  });

  it('uses canopy-adjusted radiation for dose and fit only in active mode', () => {
    const base = {
      route,
      forecast: forecast(),
      woodlandEvidence,
      canopyEvidence,
      startTime: WEATHER_FIXTURE_T0 + 10 * 60_000,
      expectedFlatSpeedMs: 3,
    };
    const off = evaluateRunV3({ ...base, canopyModelMode: 'off' });
    const shadow = evaluateRunV3({ ...base, canopyModelMode: 'shadow' });
    const active = evaluateRunV3({ ...base, canopyModelMode: 'active' });
    expect(off.plan).not.toBeNull();
    expect(active.plan).not.toBeNull();
    expect(off.plan!.physicalConditions.radiationDoseJm2).toBe(
      off.plan!.physicalConditions.openSkyRadiationDoseJm2,
    );
    expect(shadow.plan!.physicalConditions.radiationDoseJm2).toBe(
      shadow.plan!.physicalConditions.openSkyRadiationDoseJm2,
    );
    expect(active.plan!.physicalConditions.radiationDoseJm2).toBe(
      active.plan!.physicalConditions.canopyAdjustedRadiationDoseJm2,
    );
    expect(active.plan!.physicalConditions.radiationDoseJm2).toBeLessThan(
      off.plan!.physicalConditions.radiationDoseJm2,
    );
    expect(active.plan!.conditionsFit.factors.radiation).toBeLessThan(
      off.plan!.conditionsFit.factors.radiation,
    );
    expect(active.plan!.exposureSummary.meanBlockedDirectFraction).toBeGreaterThan(0);
  });

  it('filters a fixed August-noon Central Park fixture without route-specific logic', () => {
    const demo = DEMO_ROUTES.find((candidate) => candidate.route.id === 'central-park-loop')!;
    const centralParkRoute = adaptLegacyRoute(demo.route);
    const augustNoon = Date.UTC(2026, 7, 15, 16);
    const payload = makeValidWeatherPayload();
    payload.requested = {
      latitude: centralParkRoute.part.points[0].lat,
      longitude: centralParkRoute.part.points[0].lon,
    };
    payload.latitude = payload.requested.latitude;
    payload.longitude = payload.requested.longitude;
    payload.hourly.time = Array.from({ length: 4 }, (_, index) =>
      new Date(augustNoon + index * 3_600_000).toISOString(),
    );
    payload.hourly.temperature_2m = [28, 28, 28, 28];
    payload.hourly.apparent_temperature = [29, 29, 29, 29];
    payload.hourly.precipitation_probability = [0, 0, 0, 0];
    payload.hourly.precipitation = [0, 0, 0, 0];
    payload.hourly.weather_code = [1, 1, 1, 1];
    payload.hourly.shortwave_radiation = [800, 800, 800, 800];
    payload.hourly.direct_normal_irradiance = [900, 900, 900, 900];
    payload.hourly.diffuse_radiation = [150, 150, 150, 150];
    const centralParkForecast = normalizeOpenMeteoForecast(
      [payload as unknown as RawOpenMeteoLocation],
      [
        {
          lat: payload.requested.latitude,
          lon: payload.requested.longitude,
          routeDistanceM: 0,
        },
      ],
      { fetchId: 'central-park-august-noon', fetchedAt: augustNoon },
    );
    const unknownWoodland: WoodlandEvidenceProfile = {
      ...woodlandEvidence,
      values: ['unknown'],
      completeness: 'unknown',
      confidence: null,
      reasons: ['coverage.unknown'],
    };
    const input = {
      route: centralParkRoute,
      forecast: centralParkForecast,
      woodlandEvidence: unknownWoodland,
      canopyEvidence: demo.canopyEvidence,
      startTime: augustNoon,
      expectedFlatSpeedMs: 3,
    };
    const openSky = evaluateRunV3({ ...input, canopyModelMode: 'off' });
    const filtered = evaluateRunV3({ ...input, canopyModelMode: 'active' });

    expect(filtered.plan!.exposureSummary.meanBlockedDirectFraction).toBeGreaterThan(0);
    expect(filtered.plan!.physicalConditions.radiationDoseJm2).toBeLessThan(
      openSky.plan!.physicalConditions.radiationDoseJm2,
    );
    expect(filtered.plan!.conditionsFit.factors.radiation).toBeLessThan(
      openSky.plan!.conditionsFit.factors.radiation,
    );
    expect(demo.canopyEvidence.canopyPct.every((value) => value !== null)).toBe(true);
  });
});

describe('shared current evaluation and display preparation', () => {
  it('preserves the current assessment identity while returning its matching profile', () => {
    const input = {
      route,
      forecast: forecast(),
      woodlandEvidence,
      canopyEvidence,
      canopyModelMode: 'active' as const,
      startTime: WEATHER_FIXTURE_T0,
      expectedFlatSpeedMs: 3,
    };
    const combined = evaluateRunWithProfile(input);
    expect(combined.assessment).toEqual(evaluateRunV3(input));
    expect(combined.profile).toEqual(
      (buildRouteConditionsProfile(input) as { profile: unknown }).profile,
    );
    expect(
      combined.profile?.samples.every((s) => Number.isFinite(s.ambientWindDirectionFromDeg)),
    ).toBe(true);
  });
  it('returns no display profile when forecast evidence cannot support evaluation', () => {
    const combined = evaluateRunWithProfile({
      route,
      forecast: forecast(),
      woodlandEvidence,
      startTime: WEATHER_FIXTURE_T0 - 86_400_000,
      expectedFlatSpeedMs: 3,
    });
    expect(combined.assessment.evaluable).toBe(false);
    expect(combined.profile).toBeNull();
  });
});
