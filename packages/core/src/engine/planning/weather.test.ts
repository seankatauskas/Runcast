import { describe, expect, it } from 'vitest';
import {
  WEATHER_FIXTURE_HOUR_MS,
  WEATHER_FIXTURE_T0,
  makeValidWeatherPayload,
  weatherNormalizationFixtures,
  type WeatherProviderPayloadFixture,
} from '../../test-fixtures/weather-fixtures';
import {
  normalizeOpenMeteoForecast,
  sampleRouteForecast,
  ForecastNormalizationError,
  type RawOpenMeteoLocation,
} from './weather';

function normalize(payload: WeatherProviderPayloadFixture = makeValidWeatherPayload()) {
  return normalizeOpenMeteoForecast(
    [payload as unknown as RawOpenMeteoLocation],
    [{ lat: payload.requested.latitude, lon: payload.requested.longitude, routeDistanceM: 0 }],
    { fetchId: 'fixture-fetch', fetchedAt: WEATHER_FIXTURE_T0 - 1_000 },
  );
}

describe('normalizeOpenMeteoForecast', () => {
  for (const [name, fixture] of Object.entries(weatherNormalizationFixtures)) {
    it(name, () => {
      if (fixture.expected.outcome === 'accepted') {
        const field = normalize(fixture.payload);
        expect(field.missingCounts.precipitationProbabilityPct).toBe(1);
        expect(field.anchors[0].hourly.values.precipitationProbabilityPct[0]).toBeNull();
      } else {
        try {
          normalize(fixture.payload);
          throw new Error('expected normalization failure');
        } catch (error) {
          expect(error).toBeInstanceOf(ForecastNormalizationError);
          expect((error as ForecastNormalizationError).code).toBe(fixture.expected.reason);
        }
      }
    });
  }

  it('produces a stable identity while retaining requested and returned coordinates', () => {
    const first = normalize();
    const second = normalize();
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.requestedCoordinates[0]).not.toEqual(first.returnedCoordinates[0]);
  });

  it('rejects missing or extra returned locations', () => {
    expect(() =>
      normalizeOpenMeteoForecast([], [{ lat: 1, lon: 2, routeDistanceM: 0 }], {
        fetchId: 'missing',
        fetchedAt: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_LOCATION_COUNT' }));
  });
});

describe('sampleRouteForecast', () => {
  it('linearly interpolates instantaneous values and vector wind', () => {
    const result = sampleRouteForecast(
      normalize(),
      0,
      WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS / 2,
    );
    // The first probability is a provider null, so the otherwise interpolated sample abstains.
    expect(result).toMatchObject({
      status: 'unevaluable',
      reasons: ['weather.missing-critical-field:precipitationProbabilityPct'],
    });

    const payload = makeValidWeatherPayload();
    payload.hourly.precipitation_probability[0] = 10;
    const available = sampleRouteForecast(
      normalize(payload),
      0,
      WEATHER_FIXTURE_T0 + WEATHER_FIXTURE_HOUR_MS / 2,
    );
    expect(available.status).toBe('ok');
    if (available.status !== 'ok') return;
    expect(available.sample.values.temperatureC).toBeCloseTo(20.5, 8);
    const direction = available.sample.values.windDirectionFromDeg!;
    expect(Math.min(direction, 360 - direction)).toBeLessThan(3);
  });

  it('holds interval variables instead of inventing numeric transitions', () => {
    const result = sampleRouteForecast(
      normalize(),
      0,
      WEATHER_FIXTURE_T0 + 1.5 * WEATHER_FIXTURE_HOUR_MS,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sample.values.precipitationMm).toBe(2);
    expect(result.sample.values.precipitationProbabilityPct).toBe(20);
    expect(result.sample.values.gustMs).toBe(6);
    expect(result.sample.values.weatherCode).toBe(61);
    expect(result.sample.values.shortwaveRadiationWm2).toBe(300);
  });

  it('never clamps outside declared validity', () => {
    expect(sampleRouteForecast(normalize(), 0, WEATHER_FIXTURE_T0 - 1)).toEqual({
      status: 'unevaluable',
      reasons: ['weather.outside-validity'],
    });
  });
});
