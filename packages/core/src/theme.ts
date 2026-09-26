/**
 * Data colors shared by every frontend: the heat ramp, exposure band
 * colors, wind-class colors, and basemap style URLs. Web CSS chrome lives
 * in apps/web/src/ui/tokens.css; mobile chrome lives in the app's theme
 * object — but the DATA always gets its color from here, so the map, the
 * strip, and the cards can never disagree across platforms.
 *
 * The heat ramp interpolates in OKLCH so the teal→amber→red gradient is
 * perceptually even — naive RGB interpolation turns muddy between hue
 * stops.
 */
import type { SunExposure, WindClass } from './engine/types';
import runcastLightMapStyle from './data/runcast-light-map.json';

/** Feels-like °C → ramp stop color. Mirrored by --heat-* in the web CSS. */
export const HEAT_STOPS: { t: number; hex: string }[] = [
  { t: 0, hex: '#0e7490' }, // cold
  { t: 12, hex: '#14b8a6' }, // cool
  { t: 18, hex: '#d9c58a' }, // mild
  { t: 24, hex: '#f59e0b' }, // warm
  { t: 30, hex: '#ea580c' }, // hot
  { t: 36, hex: '#dc2626' }, // extreme
];

export const EXPOSURE_COLORS: Record<SunExposure, string> = {
  sun: 'rgba(251, 191, 36, 0.26)',
  shade: 'rgba(100, 116, 139, 0.22)',
  covered: 'rgba(16, 130, 90, 0.22)',
  night: 'rgba(67, 56, 202, 0.24)',
};

export const WIND_COLORS: Record<WindClass, string> = {
  head: '#6366f1',
  cross: '#818cf8',
  tail: '#a5b4fc',
  calm: '#a8a8a2',
};

/** Mirrored by --rain in the web CSS. */
export const RAIN_COLOR = '#3b82f6';

/**
 * Opaque cousin of EXPOSURE_COLORS.covered, used when the map highlights
 * the out-of-sun stretches of the route. One constant so both maps agree.
 */
export const SHADE_HIGHLIGHT_COLOR = '#22785a';

/** Sunrise/sunset tick marks on time axes. Mirrors --heat-warm. */
export const SUN_EVENT_COLOR = '#f59e0b';

export const MAP_STYLES = {
  light: runcastLightMapStyle,
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/**
 * MapLibre `line-gradient` expression for a plan's feels-like ramp: pairs
 * of [line-progress fraction, color], ≤ maxStops, strictly increasing.
 * Shared by the web and mobile map layers so the gradient is identical.
 */
export function heatGradientExpression(
  samples: readonly { distance: number; weather: { feelsLike: number } }[],
  totalDistance: number,
  maxStops = 48,
): unknown[] {
  const total = totalDistance || 1;
  const step = Math.max(1, Math.floor(samples.length / maxStops));
  const stops: (number | string)[] = [];
  let last = -1;
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i];
    const progress = Math.min(s.distance / total, 1);
    if (progress <= last) continue;
    last = progress;
    stops.push(progress, heatColor(s.weather.feelsLike));
  }
  return ['interpolate', ['linear'], ['line-progress'], ...stops];
}

/**
 * Coordinate runs for the bands matching `include` — one [lon, lat][] per
 * band, ready to become a GeoJSON MultiLineString. Bands are contiguous
 * over the samples (toBands guarantees it), so this is a single walk.
 * Shared by the web and mobile map layers.
 */
export function bandCoordinates<T>(
  samples: readonly {
    distance: number;
    position: { lat: number; lon: number };
  }[],
  bands: readonly { value: T; startDistance: number; endDistance: number }[],
  include: (value: T) => boolean,
): [number, number][][] {
  const runs: [number, number][][] = [];
  for (const band of bands) {
    if (!include(band.value) || band.endDistance <= band.startDistance) continue;
    const run: [number, number][] = [];
    for (const s of samples) {
      if (s.distance < band.startDistance || s.distance > band.endDistance) continue;
      run.push([s.position.lon, s.position.lat]);
    }
    if (run.length >= 2) runs.push(run);
  }
  return runs;
}

/* ---------- OKLCH interpolation (small, dependency-free) ---------- */

type Oklch = { l: number; c: number; h: number };

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const srgbToLinear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (x: number): number => {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(v, 0), 1) * 255);
};

function rgbToOklch(rgb: [number, number, number]): Oklch {
  const [r, g, b] = rgb.map(srgbToLinear) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(a, bb);
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c, h: (h + 360) % 360 };
}

function oklchToRgbString({ l, c, h }: Oklch): string {
  const hr = (h * Math.PI) / 180;
  const a = Math.cos(hr) * c;
  const bb = Math.sin(hr) * c;
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return `rgb(${linearToSrgb(r)}, ${linearToSrgb(g)}, ${linearToSrgb(b)})`;
}

const STOP_LCH = HEAT_STOPS.map((s) => ({
  t: s.t,
  lch: rgbToOklch(hexToRgb(s.hex)),
}));

/** Feels-like °C → CSS color, perceptually interpolated along the ramp. */
export function heatColor(feelsLike: number): string {
  const stops = STOP_LCH;
  if (feelsLike <= stops[0].t) return oklchToRgbString(stops[0].lch);
  if (feelsLike >= stops[stops.length - 1].t) {
    return oklchToRgbString(stops[stops.length - 1].lch);
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (feelsLike <= b.t) {
      const f = (feelsLike - a.t) / (b.t - a.t);
      let dh = b.lch.h - a.lch.h;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      return oklchToRgbString({
        l: a.lch.l + (b.lch.l - a.lch.l) * f,
        c: a.lch.c + (b.lch.c - a.lch.c) * f,
        h: (a.lch.h + dh * f + 360) % 360,
      });
    }
  }
  return oklchToRgbString(stops[stops.length - 1].lch);
}
