import { describe, expect, it } from 'vitest';
import { solarPosition, GEOMETRIC_SUNRISE_ELEVATION_DEG } from './solar';

const CHICAGO = { lat: 41.8781, lon: -87.6298 };

describe('solarPosition', () => {
  it('returns geometric and apparent elevation independently', () => {
    const nearSunrise = solarPosition(Date.UTC(2026, 5, 15, 10, 16), CHICAGO.lat, CHICAGO.lon);
    expect(nearSunrise.apparentElevationDeg).toBeGreaterThan(nearSunrise.geometricElevationDeg);
    expect(nearSunrise.daylight).toBe(
      nearSunrise.geometricElevationDeg >= GEOMETRIC_SUNRISE_ELEVATION_DEG,
    );
  });

  it('handles polar day and night without cloud or low-sun shade rules', () => {
    const summer = solarPosition(Date.UTC(2026, 5, 21, 0), 78.22, 15.65);
    const winter = solarPosition(Date.UTC(2026, 11, 21, 12), 78.22, 15.65);
    expect(summer.daylight).toBe(true);
    expect(winter.daylight).toBe(false);
  });
});
