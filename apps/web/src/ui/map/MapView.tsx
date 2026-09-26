/**
 * The map — Runcast's centerpiece.
 *
 * MapLibre owns the canvas; React owns nothing inside it. All dynamic state
 * arrives imperatively: conditions profile changes update source data and the
 * line-gradient paint property; hover flows through hoverBus (never through
 * React) so scrubbing stays at frame rate. The runner dot is a DOM marker
 * eased toward its target with a small rAF loop — it never teleports.
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { StyleSpecification } from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import { useEffect, useRef } from 'react';
import {
  buildSunExposureDisplayBands,
  sunExposureDisplayForWoodlandEvidence,
  classifyRouteWind,
  fmtClock,
  fmtDistance,
  fmtTemp,
  fmtWindSpeed,
  heatColor,
  hoverBus,
  M_PER_MI,
  MAP_STYLES,
  planningPositionAt,
  SHADE_HIGHLIGHT_COLOR,
  WIND_COLORS,
  type PlanningRoute,
  type RouteConditionsProfile,
  type RouteConditionsSample,
  type UnitSystem,
} from '@runcast/core';
import type { Theme } from '../../app/state';

// Bundle the worker and its shared module together for development and static releases.
maplibregl.setWorkerUrl(workerUrl);

interface Props {
  route: PlanningRoute;
  profile: RouteConditionsProfile | null;
  theme: Theme;
  units: UnitSystem;
  timezone?: string;
  /** Halo the out-of-sun stretches of the route. */
  shadeHighlight: boolean;
}

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const mapStyle = (theme: Theme): string | StyleSpecification =>
  MAP_STYLES[theme] as unknown as string | StyleSpecification;

/** Pre-rendered arrow sprite (pointing up = wind blowing north) per class. */
function arrowImage(color: string): ImageData {
  const s = 48;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  const path = new Path2D('M0 -15 L10 7 L0 1.5 L-10 7 Z');
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.stroke(path);
  ctx.fillStyle = color;
  ctx.fill(path);
  return ctx.getImageData(0, 0, s, s);
}

function routeLineData(coords: [number, number][]): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  };
}

const EMPTY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function MapView({ route, profile, theme, units, timezone, shadeHighlight }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleReady = useRef(false);

  // Latest props for imperative handlers.
  const stateRef = useRef({ route, profile, units, timezone, shadeHighlight });
  stateRef.current = { route, profile, units, timezone, shadeHighlight };

  const dotTarget = useRef<number | null>(null);
  const dotCurrent = useRef(0);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  function coordinatesAt(sample: RouteConditionsSample): [number, number] {
    const { position } = planningPositionAt(stateRef.current.route, sample.distanceM);
    return [position.lon, position.lat];
  }
  function windClass(sample: RouteConditionsSample) {
    const name = classifyRouteWind(sample);
    return { headwind: 'head', tailwind: 'tail', crosswind: 'cross', calm: 'calm' }[name];
  }

  /* ---------- imperative sync: sources, layers, paint ---------- */

  function addOverlays(map: maplibregl.Map): void {
    for (const [cls, color] of Object.entries(WIND_COLORS)) {
      if (!map.hasImage(`arrow-${cls}`)) {
        map.addImage(`arrow-${cls}`, arrowImage(color));
      }
    }

    if (map.getSource('route')) {
      // A style diff kept our overlays alive across the swap.
      styleReady.current = true;
      syncData();
      return;
    }
    map.addSource('route', { type: 'geojson', data: EMPTY, lineMetrics: true });
    map.addSource('shade', { type: 'geojson', data: EMPTY });
    map.addSource('wind', { type: 'geojson', data: EMPTY });
    map.addSource('markers', { type: 'geojson', data: EMPTY });

    // Beneath the casing: a halo around the out-of-sun stretches, not a
    // cover over the feels-like gradient. On/off is data-driven (EMPTY when
    // hidden), so there's no layer-visibility state to re-sync after theme
    // swaps.
    map.addLayer({
      id: 'shade-halo',
      type: 'line',
      source: 'shade',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': SHADE_HIGHLIGHT_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 15],
        'line-opacity': 0.8,
      },
    });
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cssVar('--route-casing'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 15, 10],
      },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cssVar('--route'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 15, 6.5],
      },
    });
    map.addLayer({
      id: 'markers-dot',
      type: 'circle',
      source: 'markers',
      minzoom: 10.5,
      paint: {
        'circle-radius': 3.5,
        'circle-color': cssVar('--surface-raised'),
        'circle-stroke-color': cssVar('--route-casing'),
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: 'markers-label',
      type: 'symbol',
      source: 'markers',
      minzoom: 11.5, // declutter: numbers appear only once zoomed in
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, -1.1],
        'text-anchor': 'bottom',
      },
      paint: {
        'text-color': cssVar('--text-secondary'),
        'text-halo-color': cssVar('--surface-raised'),
        'text-halo-width': 1.2,
      },
    });
    map.addLayer({
      id: 'wind-arrows',
      type: 'symbol',
      source: 'wind',
      layout: {
        'icon-image': ['concat', 'arrow-', ['get', 'cls']],
        'icon-rotate': ['get', 'rot'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 15, 0.8],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': false, // MapLibre declutters with zoom for free
        'icon-padding': 4,
      },
    });
    styleReady.current = true;
    syncData();
  }

  function syncData(): void {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const { route, profile, units: u, shadeHighlight: shade } = stateRef.current;

    const coords: [number, number][] = route.part.points.map((point) => [point.lon, point.lat]);
    (map.getSource('route') as maplibregl.GeoJSONSource).setData(routeLineData(coords));

    const shadeRuns =
      profile && shade
        ? buildSunExposureDisplayBands(profile.samples, profile.canopy?.modelMode ?? 'off')
            .filter((band) => !band.segmentDisplay.forecastSunlight)
            .map((band) => {
              const points = [planningPositionAt(route, band.startDistanceM).position];
              route.cumulativeDistanceM.forEach((distance, index) => {
                if (distance > band.startDistanceM && distance < band.endDistanceM)
                  points.push(route.part.points[index]);
              });
              points.push(planningPositionAt(route, band.endDistanceM).position);
              return points.map((point) => [point.lon, point.lat]);
            })
        : [];
    (map.getSource('shade') as maplibregl.GeoJSONSource).setData(
      shadeRuns.length > 0
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'MultiLineString', coordinates: shadeRuns },
          }
        : EMPTY,
    );

    if (profile) {
      // Smooth feels-like gradient along the line, ≤ 48 stops.
      const total = route.totalDistanceM || 1;
      const step = Math.max(1, Math.floor(profile.samples.length / 48));
      const stops: (number | string)[] = [];
      let lastProgress = -1;
      for (let i = 0; i < profile.samples.length; i += step) {
        const sample = profile.samples[i];
        const progress = Math.min(sample.distanceM / total, 1);
        if (progress <= lastProgress) continue;
        lastProgress = progress;
        stops.push(progress, heatColor(sample.feelsLikeC));
      }
      map.setPaintProperty('route-line', 'line-gradient', [
        'interpolate',
        ['linear'],
        ['line-progress'],
        ...stops,
      ]);

      // Wind arrows roughly every 800 m, rotated to where the wind blows.
      const arrowEvery = Math.max(1, Math.round(800 / (total / profile.samples.length)));
      const windFeatures = profile.samples
        .filter((_, i) => i % arrowEvery === Math.floor(arrowEvery / 2))
        .map((s) => ({
          type: 'Feature' as const,
          properties: {
            rot: (s.ambientWindDirectionFromDeg! + 180) % 360,
            cls: windClass(s),
          },
          geometry: {
            type: 'Point' as const,
            coordinates: coordinatesAt(s),
          },
        }));
      (map.getSource('wind') as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: windFeatures,
      });
    } else {
      map.setPaintProperty('route-line', 'line-gradient', undefined as never);
      (map.getSource('wind') as maplibregl.GeoJSONSource).setData(EMPTY);
    }

    // Distance markers in the display unit.
    const unitM = u === 'metric' ? 1000 : M_PER_MI;
    const markers = [];
    for (let k = 1; k * unitM < route.totalDistanceM; k++) {
      const { position } = planningPositionAt(route, k * unitM);
      markers.push({
        type: 'Feature' as const,
        properties: { label: String(k) },
        geometry: {
          type: 'Point' as const,
          coordinates: [position.lon, position.lat],
        },
      });
    }
    (map.getSource('markers') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: markers,
    });
  }

  /* ---------- hover: nearest sample + custom popover ---------- */

  function sampleNear(lngLat: maplibregl.LngLat): RouteConditionsSample | null {
    const profile = stateRef.current.profile;
    if (!profile) return null;
    let best: RouteConditionsSample | null = null;
    let bestD = Infinity;
    for (const s of profile.samples) {
      const { position } = planningPositionAt(stateRef.current.route, s.distanceM);
      const d =
        (position.lat - lngLat.lat) ** 2 +
        ((position.lon - lngLat.lng) * Math.cos((lngLat.lat * Math.PI) / 180)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  function showPopover(s: RouteConditionsSample): void {
    const map = mapRef.current;
    const el = popoverRef.current;
    if (!map || !el) return;
    const { units: u, timezone: tz } = stateRef.current;
    const windLabel = classifyRouteWind(s);
    const display = sunExposureDisplayForWoodlandEvidence(
      s.woodlandEvidence,
      s.daylight,
      s.radiationWm2,
      stateRef.current.profile?.canopy?.modelMode ?? 'off',
    );
    const sunLabel = !display.daylight
      ? 'After sunset'
      : display.possibleShade
        ? 'Possible shade'
        : 'Forecast sunlight';
    el.innerHTML = `
      <div class="popover-row popover-head">
        <span class="num">${fmtClock(s.time, tz)}</span>
        <span class="popover-dist num">${fmtDistance(s.distanceM, u)}</span>
      </div>
      <div class="popover-row">
        <span class="popover-dot" style="background:${heatColor(s.feelsLikeC)}"></span>
        <span>Feels like <strong class="num">${fmtTemp(s.feelsLikeC, u)}</strong></span>
      </div>
      <div class="popover-row">${sunLabel} · ${fmtWindSpeed(s.ambientWindSpeedMs, u)} ${windLabel}</div>
      ${
        s.precipitationProbabilityPct >= 8
          ? `<div class="popover-row popover-rain">☂ ${Math.round(s.precipitationProbabilityPct)}% chance of rain</div>`
          : ''
      }`;
    const pt = map.project(coordinatesAt(s));
    el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, calc(-100% - 14px))`;
    el.style.opacity = '1';
  }

  function hidePopover(): void {
    if (popoverRef.current) popoverRef.current.style.opacity = '0';
  }

  /* ---------- mount ---------- */

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: mapStyle(theme),
      attributionControl: { compact: true },
      pitch: 40,
      center: [route.part.points[0].lon, route.part.points[0].lat],
      zoom: 12,
    });
    mapRef.current = map;
    map.on('load', () => addOverlays(map));

    const dotEl = document.createElement('div');
    dotEl.className = 'runner-dot';
    markerRef.current = new maplibregl.Marker({ element: dotEl })
      .setLngLat([route.part.points[0].lon, route.part.points[0].lat])
      .addTo(map);

    map.on('mousemove', (e) => {
      const hits = map.queryRenderedFeatures(
        [
          [e.point.x - 10, e.point.y - 10],
          [e.point.x + 10, e.point.y + 10],
        ],
        { layers: styleReady.current ? ['route-line'] : [] },
      );
      if (hits.length > 0) {
        const s = sampleNear(e.lngLat);
        if (s) {
          map.getCanvas().style.cursor = 'crosshair';
          hoverBus.publish({ distance: s.distanceM, source: 'map' });
          showPopover(s);
          return;
        }
      }
      map.getCanvas().style.cursor = '';
      if (hoverBus.value.distance !== null && hoverBus.value.source === 'map') {
        hoverBus.publish({ distance: null, source: 'map' });
        hidePopover();
      }
    });
    map.on('mouseout', () => {
      if (hoverBus.value.source === 'map') {
        hoverBus.publish({ distance: null, source: 'map' });
        hidePopover();
      }
    });

    // Runner dot easing loop — chases the hovered distance, never jumps.
    let raf = 0;
    const tick = () => {
      const target = dotTarget.current ?? 0;
      const cur = dotCurrent.current;
      const next = Math.abs(target - cur) < 1 ? target : cur + (target - cur) * 0.18;
      if (next !== cur) {
        dotCurrent.current = next;
        const { position } = planningPositionAt(stateRef.current.route, next);
        markerRef.current?.setLngLat([position.lon, position.lat]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const unsub = hoverBus.subscribe(({ distance, source }) => {
      dotTarget.current = distance;
      if (source !== 'map') {
        // Linked hover from the strip: anchor the popover to the sample.
        const profile = stateRef.current.profile;
        if (distance !== null && profile) {
          const i = Math.min(
            Math.round(
              (distance / stateRef.current.route.totalDistanceM) * (profile.samples.length - 1),
            ),
            profile.samples.length - 1,
          );
          showPopover(profile.samples[i]);
        } else {
          hidePopover();
        }
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      map.remove();
      mapRef.current = null;
      styleReady.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- prop-driven updates ---------- */

  // Theme: swap basemap style, then re-add overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!styleReady.current) return; // initial style still loading
    styleReady.current = false;
    // diff:false forces a full style reload — deterministic teardown of our
    // overlay layers instead of a partial diff that may or may not keep them.
    map.setStyle(mapStyle(theme), { diff: false });
    // Neither 'style.load' nor a single 'styledata' reliably marks the end
    // of a setStyle swap (the last styledata can arrive while the style
    // still reports unloaded). Poll until the style is actually ready.
    const restore = () => {
      if (mapRef.current !== map) return; // unmounted or replaced
      if (map.isStyleLoaded()) addOverlays(map);
      else window.setTimeout(restore, 50);
    };
    window.setTimeout(restore, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Data: conditions profile / units / highlight changes re-sync sources.
  useEffect(() => {
    syncData();
    const distance = hoverBus.value.distance;
    const sample =
      distance === null
        ? undefined
        : profile?.samples.reduce((nearest, current) =>
            Math.abs(current.distanceM - distance) < Math.abs(nearest.distanceM - distance)
              ? current
              : nearest,
          );
    if (sample) showPopover(sample);
    else hidePopover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, profile, units, timezone, shadeHighlight]);

  // Camera: frame each newly selected route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const point of route.part.points) bounds.extend([point.lon, point.lat]);
    map.fitBounds(bounds, {
      padding: { top: 56, bottom: 48, left: 376, right: 56 },
      pitch: 40,
      duration: 1200,
      essential: true,
    });
    dotCurrent.current = 0;
    dotTarget.current = null;
    markerRef.current?.setLngLat([route.part.points[0].lon, route.part.points[0].lat]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id]);

  return (
    <div className="map-wrap" ref={containerRef}>
      <div className="map-popover" ref={popoverRef} />
    </div>
  );
}
