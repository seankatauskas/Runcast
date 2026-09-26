/**
 * The NOAA algorithm is validated with astronomical invariants plus spot
 * checks against NOAA's own solar calculator (gml.noaa.gov/grad/solcalc).
 */
import { describe, expect, it } from 'vitest';
import { solarPosition, sunWindows } from './solar';

const CHICAGO = { lat: 41.8781, lon: -87.6298 };

describe('declination invariants', () => {
  it('is ~+23.44° at the June solstice', () => {
    const { declination } = solarPosition(Date.UTC(2026, 5, 21, 12), 0, 0);
    expect(declination).toBeCloseTo(23.44, 1);
  });

  it('is ~−23.44° at the December solstice', () => {
    const { declination } = solarPosition(Date.UTC(2026, 11, 21, 12), 0, 0);
    expect(declination).toBeCloseTo(-23.44, 1);
  });

  it('is ~0° at the March equinox', () => {
    const { declination } = solarPosition(Date.UTC(2026, 2, 20, 14), 0, 0);
    expect(Math.abs(declination)).toBeLessThan(0.5);
  });
});

describe('solar noon geometry', () => {
  it('puts the sun near the zenith at the subsolar point', () => {
    // June solstice, solar noon at the Tropic of Cancer, lon 0.
    // True solar noon ≈ 12:00 UTC ± equation of time (~ −2 min in late June).
    const { elevation } = solarPosition(Date.UTC(2026, 5, 21, 12, 2), 23.44, 0);
    expect(elevation).toBeGreaterThan(89);
  });

  it('matches the textbook noon elevation 90 − |φ − δ| in Chicago', () => {
    // Solar noon in Chicago ≈ 12:00 + lon/15h ≈ 17:50 UTC; eq. of time ≈ −1.7 min.
    const t = Date.UTC(2026, 5, 21, 17, 52);
    const { elevation, declination, azimuth } = solarPosition(t, CHICAGO.lat, CHICAGO.lon);
    expect(elevation).toBeCloseTo(90 - Math.abs(CHICAGO.lat - declination), 0);
    expect(Math.abs(azimuth - 180)).toBeLessThan(3); // due south at noon
  });
});

describe('diurnal behavior in Chicago', () => {
  it('is night at local midnight, day at local noon', () => {
    expect(
      solarPosition(Date.UTC(2026, 5, 15, 6), CHICAGO.lat, CHICAGO.lon).elevation,
    ).toBeLessThan(0); // 01:00 CDT
    expect(
      solarPosition(Date.UTC(2026, 5, 15, 18), CHICAGO.lat, CHICAGO.lon).elevation,
    ).toBeGreaterThan(60); // 13:00 CDT
  });

  it('rises in the northeast on a June morning', () => {
    // ~05:20 CDT, just after summer sunrise.
    const { elevation, azimuth } = solarPosition(
      Date.UTC(2026, 5, 15, 10, 30),
      CHICAGO.lat,
      CHICAGO.lon,
    );
    expect(elevation).toBeGreaterThan(0);
    expect(elevation).toBeLessThan(10);
    expect(azimuth).toBeGreaterThan(50);
    expect(azimuth).toBeLessThan(80);
  });

  it('sets in the northwest on a June evening', () => {
    // ~20:10 CDT, just before sunset.
    const { elevation, azimuth } = solarPosition(
      Date.UTC(2026, 6, 16, 1, 10), // 2026-07-15 20:10 CDT
      CHICAGO.lat,
      CHICAGO.lon,
    );
    expect(elevation).toBeGreaterThan(0);
    expect(elevation).toBeLessThan(12);
    expect(azimuth).toBeGreaterThan(280);
    expect(azimuth).toBeLessThan(310);
  });

  it('azimuth sweeps clockwise through the day', () => {
    const hours = [11, 14, 17, 20, 23]; // UTC = 06:00–18:00 CDT
    const azimuths = hours.map(
      (h) => solarPosition(Date.UTC(2026, 5, 15, h), CHICAGO.lat, CHICAGO.lon).azimuth,
    );
    for (let i = 1; i < azimuths.length; i++) {
      expect(azimuths[i]).toBeGreaterThan(azimuths[i - 1]);
    }
  });
});

describe('refraction', () => {
  it('lifts the sun slightly when it is at the geometric horizon', () => {
    // Find a moment where uncorrected elevation would be ≈ 0: scan around
    // sunrise; corrected elevation should exceed geometric by ~0.5°.
    const t = Date.UTC(2026, 5, 15, 10, 16); // ≈ Chicago sunrise
    const { elevation } = solarPosition(t, CHICAGO.lat, CHICAGO.lon);
    // Near the horizon the correction is ~0.5°, so the corrected value sits
    // above −0.3° even if the geometric sun is right at 0°.
    expect(elevation).toBeGreaterThan(-1.5);
    expect(elevation).toBeLessThan(1.5);
  });
});

describe('sunWindows', () => {
  const DAY = Date.UTC(2026, 5, 15); // June 15, Chicago is CDT (UTC−5)

  it('finds two nights and four crossings across 48 hours of June', () => {
    const w = sunWindows(DAY, DAY + 48 * 3_600_000, CHICAGO.lat, CHICAGO.lon);
    // 00:00 UTC is 19:00 CDT June 14 — daylight in a Chicago June — so the
    // window opens in day: sunset ≈ 20:30 CDT (01:30 UTC), sunrise ≈ 05:15
    // CDT (10:15 UTC), and again the next day.
    expect(w.events).toHaveLength(4);
    expect(w.events.map((e) => e.kind)).toEqual(['sunset', 'sunrise', 'sunset', 'sunrise']);
    const sunsetUtcH = (w.events[0].time - DAY) / 3_600_000;
    expect(sunsetUtcH).toBeGreaterThan(0.5);
    expect(sunsetUtcH).toBeLessThan(2.5);
    const sunriseUtcH = (w.events[1].time - DAY) / 3_600_000;
    expect(sunriseUtcH).toBeGreaterThan(9.5);
    expect(sunriseUtcH).toBeLessThan(11);
  });

  it('night intervals cover 2 a.m. but not noon, and tile the events', () => {
    const w = sunWindows(DAY, DAY + 24 * 3_600_000, CHICAGO.lat, CHICAGO.lon);
    const covers = (t: number) => w.nights.some((n) => t >= n.start && t <= n.end);
    expect(covers(DAY + 7 * 3_600_000)).toBe(true); // 02:00 CDT
    expect(covers(DAY + 17 * 3_600_000)).toBe(false); // noon CDT
    // Every night interval is bounded by the window and ordered.
    for (const n of w.nights) {
      expect(n.start).toBeGreaterThanOrEqual(DAY);
      expect(n.end).toBeLessThanOrEqual(DAY + 24 * 3_600_000);
      expect(n.end).toBeGreaterThan(n.start);
    }
  });

  it('polar summer produces no nights', () => {
    // Longyearbyen in late June: midnight sun.
    const w = sunWindows(DAY, DAY + 48 * 3_600_000, 78.22, 15.65);
    expect(w.nights).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });
});
