/**
 * Shared geometry, historical storage DTOs, and presentation enums.
 * Current evaluator vocabulary lives in engine/planning/types.ts.
 *
 * Unit conventions (everywhere in `src/engine` and `src/io`):
 *   distance      meters
 *   duration      seconds
 *   timestamps    epoch milliseconds (UTC)
 *   speed         m/s  (pace exists only in the display layer)
 *   temperature   °C   (deliberate deviation from strict SI; kelvin helps no one)
 *   angles        degrees; bearings & azimuth 0° = north, clockwise;
 *                 solar elevation measured up from the horizon
 *
 * Conversion to display units (mi, °F, min/mi…) happens only in `src/format`.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RoutePoint extends LatLon {
  /** Elevation above sea level, meters. 0 if the GPX had none. */
  ele: number;
}

export interface Route {
  id: string;
  name: string;
  points: RoutePoint[];
  /** Cumulative distance in meters at each point; cumulative[0] === 0. */
  cumulative: number[];
  totalDistance: number;
}

/** One hourly forecast series at a fixed location. Arrays are index-aligned. */
export interface HourlySeries {
  /** Epoch ms for each hour. */
  time: number[];
  /** Air temperature at 2 m, °C. */
  temp: number[];
  /** Apparent ("feels like") temperature, °C. */
  feelsLike: number[];
  /** Relative humidity at 2 m, percent 0–100. */
  humidity: number[];
  /** Wind speed at 10 m, m/s. */
  windSpeed: number[];
  /** Meteorological wind direction — where the wind comes FROM, degrees. */
  windDirFrom: number[];
  /** Wind gusts at 10 m, m/s. */
  gust: number[];
  /** Total cloud cover, percent 0–100. */
  cloudCover: number[];
  /** Probability of precipitation, percent 0–100. */
  precipProb: number[];
  /** Precipitation amount, mm per hour. */
  precip: number[];
  /**
   * WMO weather interpretation code (categorical — never interpolated,
   * only scanned for alerts: 95–99 thunderstorm, 65/67/82 heavy rain…).
   */
  weatherCode: number[];
}

/**
 * Historical cached weather stored before normalized forecast artifacts.
 * Retained for persistence readers; live evaluation uses NormalizedRouteForecast.
 */
export interface WeatherField {
  anchors: {
    /** Position of this anchor along the route, meters. */
    routeDistance: number;
    lat: number;
    lon: number;
    hourly: HourlySeries;
  }[];
  fetchedAt: number;
}

/** Ground-cover class along the route, time-independent, from OSM data. */
export type Coverage = 'open' | 'tree' | 'unknown';

/** Coverage sampled at a fixed distance resolution along a route. */
export interface CoverageMask {
  /** Meters between consecutive values. */
  resolution: number;
  values: Coverage[];
}

export type WindClass = 'head' | 'tail' | 'cross' | 'calm';
export type SunExposure = 'sun' | 'shade' | 'covered' | 'night';

export type AlertKind = 'thunderstorm' | 'heavy-rain' | 'extreme-heat' | 'high-wind';

export interface WeatherAlert {
  kind: AlertKind;
  /** Peak value behind the alert (mm/h, °C, or m/s depending on kind). */
  peak: number;
}
