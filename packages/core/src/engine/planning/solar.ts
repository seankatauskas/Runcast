import { solarPosition as calculateAstronomicalSolarPosition } from '../solar';

export const GEOMETRIC_SUNRISE_ELEVATION_DEG = -0.833;

export interface SolarPosition {
  geometricElevationDeg: number;
  apparentElevationDeg: number;
  azimuthDeg: number;
  declinationDeg: number;
  daylight: boolean;
}

/** The sunrise convention is applied once to the geometric solar center. */
export function solarPosition(at: number, lat: number, lon: number): SolarPosition {
  const position = calculateAstronomicalSolarPosition(at, lat, lon);
  return {
    geometricElevationDeg: position.geometricElevation,
    apparentElevationDeg: position.apparentElevation,
    azimuthDeg: position.azimuth,
    declinationDeg: position.declination,
    daylight: position.geometricElevation >= GEOMETRIC_SUNRISE_ELEVATION_DEG,
  };
}
