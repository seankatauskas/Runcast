/**
 * Solar position — NOAA's solar calculation algorithm.
 *
 * This is a port of the equations behind NOAA's Solar Calculator
 * (gml.noaa.gov/grad/solcalc), themselves from Meeus, *Astronomical
 * Algorithms*. Accuracy is quoted at ±0.01° for years 1800–2200 — orders of
 * magnitude tighter than this app needs (whether a runner is in sun is a
 * question of degrees, not arcseconds).
 *
 * Pipeline: epoch ms → Julian centuries since J2000 → solar declination and
 * the equation of time → local hour angle → elevation (with atmospheric
 * refraction) and azimuth.
 */
import { normalizeBearing, toDeg, toRad } from './geo';

export interface SolarPosition {
  /** Degrees above the horizon, refraction-corrected. */
  elevation: number;
  /** Solar-center elevation before atmospheric refraction. */
  geometricElevation: number;
  /** Refraction-corrected solar-center elevation. */
  apparentElevation: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Solar declination, degrees (exposed for tests). */
  declination: number;
}

/** Sun is "up" above this elevation (accounts for refraction + solar disc). */
export const SUNRISE_ELEVATION = -0.833;

const JULIAN_EPOCH_MS = 2440587.5; // Julian date of 1970-01-01T00:00Z

/** Julian centuries since J2000.0 for an epoch-ms timestamp. */
function julianCenturies(t: number): number {
  const jd = t / 86400000 + JULIAN_EPOCH_MS;
  return (jd - 2451545) / 36525;
}

interface SolarCore {
  declination: number; // degrees
  eqOfTime: number; // minutes
}

function solarCore(T: number): SolarCore {
  // Geometric mean longitude and anomaly of the sun (degrees).
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  // Eccentricity of earth's orbit.
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  // Equation of the center → true and apparent longitude.
  const Mr = toRad(M);
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = toRad(125.04 - 1934.136 * T);
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega);
  // Obliquity of the ecliptic, corrected for nutation.
  const meanObliq = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega);

  const obliqR = toRad(obliq);
  const declination = toDeg(Math.asin(Math.sin(obliqR) * Math.sin(toRad(apparentLong))));

  // Equation of time (true solar time − mean solar time), minutes.
  const y = Math.tan(obliqR / 2) ** 2;
  const L0r = toRad(L0);
  const eqOfTime =
    4 *
    toDeg(
      y * Math.sin(2 * L0r) -
        2 * e * Math.sin(Mr) +
        4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
        0.5 * y * y * Math.sin(4 * L0r) -
        1.25 * e * e * Math.sin(2 * Mr),
    );

  return { declination, eqOfTime };
}

/** NOAA's atmospheric refraction correction, degrees, applied near horizon. */
function refractionCorrection(elevation: number): number {
  if (elevation > 85) return 0;
  const tanE = Math.tan(toRad(elevation));
  let corr: number;
  if (elevation > 5) {
    corr = 58.1 / tanE - 0.07 / tanE ** 3 + 0.000086 / tanE ** 5;
  } else if (elevation > -0.575) {
    corr =
      1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  } else {
    corr = -20.774 / tanE;
  }
  return corr / 3600;
}

/** Sun elevation and azimuth at epoch-ms time t, seen from (lat, lon). */
export function solarPosition(t: number, lat: number, lon: number): SolarPosition {
  const T = julianCenturies(t);
  const { declination, eqOfTime } = solarCore(T);

  // True solar time: minutes past local solar midnight.
  const msIntoUtcDay = ((t % 86400000) + 86400000) % 86400000;
  const trueSolarMin = (msIntoUtcDay / 60000 + eqOfTime + 4 * lon + 1440) % 1440;
  const hourAngle = trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180;

  const latR = toRad(lat);
  const decR = toRad(declination);
  const haR = toRad(hourAngle);

  const cosZenith = Math.min(
    Math.max(Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR), -1),
    1,
  );
  const zenith = toDeg(Math.acos(cosZenith));
  const elevation = 90 - zenith;

  const sinZenith = Math.sin(toRad(zenith));
  let azimuth: number;
  if (Math.abs(sinZenith) < 1e-9) {
    // Sun at zenith/nadir: azimuth undefined; pick something stable.
    azimuth = lat >= declination ? 180 : 0;
  } else {
    const cosAz = Math.min(
      Math.max((Math.sin(latR) * cosZenith - Math.sin(decR)) / (Math.cos(latR) * sinZenith), -1),
      1,
    );
    const az = toDeg(Math.acos(cosAz));
    azimuth = hourAngle > 0 ? normalizeBearing(az + 180) : normalizeBearing(540 - az);
  }

  const apparentElevation = elevation + refractionCorrection(elevation);
  return {
    elevation: apparentElevation,
    geometricElevation: elevation,
    apparentElevation,
    azimuth,
    declination,
  };
}

/** A window of wall-clock time classified against the horizon. */
export interface SunWindows {
  /** Intervals within [start, end] where the sun is below SUNRISE_ELEVATION. */
  nights: { start: number; end: number }[];
  /** Horizon crossings within (start, end), in time order. */
  events: { time: number; kind: 'sunrise' | 'sunset' }[];
}

/**
 * Where night falls (and the sun rises/sets) across a time window at one
 * place — the scrubber's time axis wants to show what the exposure model
 * already knows. Coarse scan at `stepMs`, then bisection refines each
 * crossing to well under a second.
 */
export function sunWindows(
  start: number,
  end: number,
  lat: number,
  lon: number,
  stepMs = 10 * 60_000,
): SunWindows {
  const below = (t: number): boolean => solarPosition(t, lat, lon).elevation < SUNRISE_ELEVATION;

  const nights: SunWindows['nights'] = [];
  const events: SunWindows['events'] = [];
  let prevT = start;
  let prevBelow = below(start);
  let nightStart: number | null = prevBelow ? start : null;

  for (let t = start + stepMs; prevT < end; t += stepMs) {
    const now = Math.min(t, end);
    const nowBelow = below(now);
    if (nowBelow !== prevBelow) {
      let lo = prevT;
      let hi = now;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid) === prevBelow) lo = mid;
        else hi = mid;
      }
      const crossing = (lo + hi) / 2;
      if (nowBelow) {
        events.push({ time: crossing, kind: 'sunset' });
        nightStart = crossing;
      } else {
        events.push({ time: crossing, kind: 'sunrise' });
        nights.push({ start: nightStart ?? start, end: crossing });
        nightStart = null;
      }
    }
    prevT = now;
    prevBelow = nowBelow;
  }
  if (nightStart !== null) nights.push({ start: nightStart, end });
  return { nights, events };
}
