import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  evaluateRunWithProfile,
  normalizeOpenMeteoForecast,
  parsePlanningGpx,
  playbackDistanceAtTime,
} from '@runcast/core';
import {
  makeValidWeatherPayload,
  WEATHER_FIXTURE_T0,
} from '../../../../packages/core/src/test-fixtures/weather-fixtures';
import { Splits } from './cards/Splits';
import { StripLegend } from './strip/StripLegend';
import { SummaryCards } from './cards/SummaryCards';
import type { Planner } from '../app/state';

const route = parsePlanningGpx(
  '<gpx><trk><trkseg><trkpt lat="41.9" lon="-87.6"/><trkpt lat="41.91" lon="-87.59"/></trkseg></trk></gpx>',
  'ui-route',
  'UI route',
);
function currentRun(missing = false) {
  const payload = makeValidWeatherPayload();
  payload.hourly.precipitation.fill(0);
  payload.hourly.precipitation_probability.fill(0);
  payload.hourly.weather_code.fill(1);
  if (missing) payload.hourly.temperature_2m.fill(null);
  const forecast = normalizeOpenMeteoForecast(
    [payload],
    [{ routeDistanceM: 0, lat: 41.9, lon: -87.6 }],
    { fetchId: 'ui', fetchedAt: WEATHER_FIXTURE_T0 },
  );
  return evaluateRunWithProfile({
    route,
    forecast,
    woodlandEvidence: {
      schemaVersion: 2,
      values: ['unknown'],
      resolutionM: 2000,
      source: 'test',
      fetchedAt: null,
      parserVersion: 'test',
      completeness: 'unknown',
      confidence: null,
      reasons: [],
    },
    canopyModelMode: 'active',
    startTime: WEATHER_FIXTURE_T0,
    expectedFlatSpeedMs: 3,
  });
}

describe('current planning presentation', () => {
  it('renders splits and sunlight directly from a current profile with missing elevation', () => {
    const { assessment, profile } = currentRun();
    expect(profile?.samples.every((s) => s.elevationM === null)).toBe(true);
    const planner = {
      routeConditionsProfile: profile,
      evaluatedRun: assessment.plan,
      recommendation: null,
      units: 'metric',
      timezone: 'America/Chicago',
      weatherStatus: 'ready',
      retryWeather: () => {},
      toggleShadeHighlight: () => {},
    } as Planner;
    expect(renderToStaticMarkup(<Splits planner={planner} />)).toContain('Splits');
    expect(renderToStaticMarkup(<StripLegend profile={profile} />)).toMatch(
      /forecast sunlight|after sunset/,
    );
    const summary = renderToStaticMarkup(<SummaryCards planner={planner} />);
    expect(summary).toContain('flat timing');
    expect(summary).not.toContain('Legacy');
    const samples = profile!.samples;
    expect(playbackDistanceAtTime(samples, samples[0].time)).toBe(0);
    expect(playbackDistanceAtTime(samples, samples.at(-1)!.time)).toBeCloseTo(route.totalDistanceM);
  });
  it('withholds conditions when required forecast evidence is missing', () => {
    const result = currentRun(true);
    expect(result.assessment.evaluable).toBe(false);
    expect(result.profile).toBeNull();
    expect(renderToStaticMarkup(<StripLegend profile={result.profile} />)).toBe('');
  });
});
