/**
 * The map, mobile edition: one brand-color route over a muted OpenFreeMap
 * basemap, with neutral casing, distance markers, and an eased runner dot.
 * Detailed condition encoding, including route-relative wind, lives in the
 * forecast ribbon.
 * Hover becomes touch:
 * tapping the route (sources are natively pressable in MapLibre RN v11)
 * publishes to the shared bus, exactly like a web hover.
 */
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MLMap,
  Marker,
  type CameraRef,
  type LngLat,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  fmtDistance,
  hoverBus,
  M_PER_MI,
  positionAt,
  type Route,
  type RouteConditionsProfile,
} from '@runcast/core';
import { outOfSunCoordinates } from '../data/planningPresentation';
import type { Chrome } from '../theme';
import { IconButton } from '../design/Primitives';
import { SHADOW, SP } from '../theme';
import type { ThemeName } from '../state';
import { coordinatesWithinMeters } from './mapGeometry';
import { mobileMapStyle } from './mobileMapStyle';

const ROUTE_PITCH = 10;
const LOOP_ENDPOINT_THRESHOLD_M = 65;

interface Props {
  route: Route;
  profile: RouteConditionsProfile | null;
  themeName: ThemeName;
  chrome: Chrome;
  units: 'metric' | 'imperial';
  /** Extra bottom padding so Explorer chrome doesn't cover the route. */
  bottomInset: number;
  /** Halo V2-derived possible-shade and after-sunset stretches of the route. */
  shadeHighlight: boolean;
  /** Show the transient focus/play marker linked through hoverBus. */
  showFocusMarker?: boolean;
  /** Let presses on the route publish a focused distance. */
  routePressEnabled?: boolean;
}

function boundsOf(route: Route): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of route.points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [w, s, e, n];
}

function EndpointBadge({ kind, chrome }: { kind: 'start' | 'finish' | 'loop'; chrome: Chrome }) {
  const start = kind === 'start';
  const loop = kind === 'loop';
  return (
    <View
      accessible={false}
      style={[
        styles.endpoint,
        loop && styles.loopEndpoint,
        {
          backgroundColor: start ? chrome.route : chrome.cockpitRaised,
          borderColor: start ? chrome.routeCasing : chrome.route,
        },
      ]}
    >
      <Text
        style={[
          styles.endpointLabel,
          loop && styles.loopEndpointLabel,
          { color: start ? chrome.cockpitAccentText : chrome.cockpitText },
        ]}
      >
        {loop ? 'S/F' : start ? 'S' : 'F'}
      </Text>
    </View>
  );
}

/**
 * Center+zoom that frames the given bounds in a viewport, honoring
 * asymmetric padding. Computed in JS because the native bounds camera stop
 * (fitBounds) is unreliable in MapLibre RN v11 on iOS — it intermittently
 * applies no movement at all — while center+zoom stops always work.
 */
function cameraForBounds(
  [w, s, e, n]: [number, number, number, number],
  viewW: number,
  viewH: number,
  pad: { top: number; bottom: number; left: number; right: number },
): { center: LngLat; zoom: number } {
  const WORLD = 512; // px at zoom 0
  const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const dx = Math.max((e - w) / 360, 1e-9);
  const dy = Math.max((mercY(n) - mercY(s)) / (2 * Math.PI), 1e-9);
  const availW = Math.max(viewW - pad.left - pad.right, 50);
  const availH = Math.max(viewH - pad.top - pad.bottom, 50);
  // Keep a sliver of slack for the pitched frustum without making the route
  // feel undersized in the visible map window.
  const zoom = Math.min(Math.log2(availW / WORLD / dx), Math.log2(availH / WORLD / dy)) - 0.03;
  // Shift the camera center so the bounds sit centered between the pads.
  const pxPerMerc = (WORLD * 2 ** zoom) / (2 * Math.PI);
  const cy = (mercY(n) + mercY(s)) / 2 + (pad.top - pad.bottom) / 2 / pxPerMerc;
  const lat = ((2 * Math.atan(Math.exp(cy)) - Math.PI / 2) * 180) / Math.PI;
  return { center: [(w + e) / 2, lat], zoom };
}

export function RunMap({
  route,
  profile,
  themeName,
  chrome,
  units,
  bottomInset,
  shadeHighlight,
  showFocusMarker = true,
  routePressEnabled = true,
}: Props) {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [cameraMoved, setCameraMoved] = useState(false);
  const [dotLngLat, setDotLngLat] = useState<LngLat>([route.points[0].lon, route.points[0].lat]);

  const routeGeoJSON = useMemo(() => {
    const coords = route.points.map((point) => [point.lon, point.lat] as [number, number]);
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: coords },
    };
  }, [route]);

  const shadeGeoJSON = useMemo(() => {
    if (!profile || !shadeHighlight) return null;
    const runs = outOfSunCoordinates(route, profile);
    if (runs.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'MultiLineString' as const, coordinates: runs },
    };
  }, [profile, route, shadeHighlight]);

  const markerGeoJSON = useMemo(() => {
    const unitM = units === 'metric' ? 1000 : M_PER_MI;
    const features = [];
    for (let k = 1; k * unitM < route.totalDistance; k++) {
      const { position } = positionAt(route, k * unitM);
      features.push({
        type: 'Feature' as const,
        properties: { label: String(k) },
        geometry: {
          type: 'Point' as const,
          coordinates: [position.lon, position.lat],
        },
      });
    }
    return { type: 'FeatureCollection' as const, features };
  }, [route, units]);

  // Frame the route whenever it changes. fitBounds needs the native view to
  // already have a real measured size — calling it before that (e.g. on a
  // fixed timeout) intermittently fails with "padding is greater than map's
  // height or width" on cold start. onDidFinishLoadingMap is the reliable
  // "the view exists and has a size" signal; route switches after that fire
  // straight from this effect since the map is already ready.
  const fitStateRef = useRef({ route, bottomInset });
  fitStateRef.current = { route, bottomInset };

  // The whole-run framing, computed in JS and driven declaratively: props
  // on <Camera> survive native init ordering (the native side re-applies
  // its stored stop after layout), where imperative fit calls at startup
  // were intermittently swallowed.
  const fit = useMemo(() => {
    return cameraForBounds(boundsOf(route), viewportWidth, viewportHeight, {
      // Reserve honest space for the floating controls and endpoint badges,
      // then keep the route optically centered in the map that remains.
      top: 112,
      bottom: bottomInset + 18,
      left: 22,
      right: 22,
    });
  }, [bottomInset, route, viewportHeight, viewportWidth]);
  const routeRenderKey = `${route.id}:${route.points[0].lat}:${route.points[0].lon}:${route.points.length}`;
  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;

  const firstPoint = route.points[0];
  const lastPoint = route.points[route.points.length - 1];
  const startLngLat: LngLat = [firstPoint.lon, firstPoint.lat];
  const finishLngLat: LngLat = [lastPoint.lon, lastPoint.lat];
  const isLoop = coordinatesWithinMeters(firstPoint, lastPoint, LOOP_ENDPOINT_THRESHOLD_M);

  // Runner dot chases the hovered/played distance, eased — except while
  // scrubbing the strip, where easing reads as lag under the finger: a
  // strip publish snaps the dot to the touch immediately.
  const target = useRef<number | null>(null);
  const current = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const lastFollowCheck = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = target.current ?? 0;
      const cur = current.current;
      const next = Math.abs(t - cur) < 1 ? t : cur + (t - cur) * 0.18;
      if (next !== cur) {
        current.current = next;
        const { position } = positionAt(routeRef.current, next);
        setDotLngLat([position.lon, position.lat]);
      }
      if (Math.abs(t - next) >= 1) raf = requestAnimationFrame(tick);
      else raf = 0;
    };
    const animate = () => {
      if (raf === 0) raf = requestAnimationFrame(tick);
    };
    const unsub = hoverBus.subscribe(({ distance, source }) => {
      target.current = distance;
      animate();
      if (distance === null) return;

      if (source === 'strip') {
        current.current = distance;
        const { position } = positionAt(routeRef.current, distance);
        setDotLngLat([position.lon, position.lat]);
      }

      // Flyover follow-cam: if playback carries the dot out of the frame,
      // ease the camera back onto it. The recenter target is shifted south
      // in JS so the dot lands centered in the visible area above the
      // Explorer card (native padding options are part of the same machinery that
      // proved unreliable, so the camera only ever gets plain centers).
      if (source === 'play') {
        const now = Date.now();
        if (now - lastFollowCheck.current < 700) return;
        lastFollowCheck.current = now;
        const { position } = positionAt(routeRef.current, distance);
        mapRef.current
          ?.getBounds()
          .then(([w, s, e, n]) => {
            const mx = (e - w) * 0.18;
            const my = (n - s) * 0.18;
            const out =
              position.lon < w + mx ||
              position.lon > e - mx ||
              position.lat < s + my ||
              position.lat > n - my;
            if (!out) return;
            const vh = viewportHeightRef.current;
            const inset = fitStateRef.current.bottomInset;
            const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
            const mercPerPx = (mercY(n) - mercY(s)) / vh;
            const dotScreenY = (110 + (vh - inset - 40)) / 2;
            const cy = mercY(position.lat) - (vh / 2 - dotScreenY) * mercPerPx;
            const lat = ((2 * Math.atan(Math.exp(cy)) - Math.PI / 2) * 180) / Math.PI;
            cameraRef.current?.easeTo({
              center: [position.lon, lat],
              duration: 600,
            });
          })
          .catch(() => {});
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, []);

  useEffect(() => {
    current.current = 0;
    target.current = null;
    setCameraMoved(false);
    setDotLngLat([route.points[0].lon, route.points[0].lat]);
  }, [route.id, route.points]);

  function restoreRouteFrame(): void {
    setCameraMoved(false);
    cameraRef.current?.easeTo({
      center: fit.center,
      zoom: fit.zoom,
      bearing: 0,
      pitch: ROUTE_PITCH,
      duration: 600,
      easing: 'ease',
    });
  }

  function onRoutePress(lngLat: LngLat): void {
    if (!profile) return;
    let best = 0;
    let bestD = Infinity;
    const cosLat = Math.cos((lngLat[1] * Math.PI) / 180);
    for (const sample of profile.samples) {
      const { position } = positionAt(route, sample.distanceM);
      const d = (position.lat - lngLat[1]) ** 2 + ((position.lon - lngLat[0]) * cosLat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = sample.distanceM;
      }
    }
    hoverBus.publish({ distance: best, source: 'map' });
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <MLMap
        key={`explorer-map:${routeRenderKey}`}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={mobileMapStyle(themeName)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Map of ${route.name}, ${fmtDistance(route.totalDistance, units)}, with start, finish, and distance markers`}
        accessibilityHint={
          routePressEnabled
            ? 'Use the route conditions chart for an accessible description of conditions along the route.'
            : undefined
        }
        attribution={false}
        logo={false}
        compass
        compassHiddenFacingNorth
        compassPosition={{ top: 108, left: SP[4] }}
        scaleBar={false}
        touchPitch={false}
        onRegionDidChange={(event) => {
          if (event.nativeEvent.userInteraction) setCameraMoved(true);
        }}
        onPress={() => {
          if (hoverBus.value.distance !== null) {
            hoverBus.publish({ distance: null, source: 'map' });
          }
        }}
      >
        <Camera
          key={`camera:${routeRenderKey}`}
          ref={cameraRef}
          initialViewState={{
            center: fit.center,
            zoom: fit.zoom,
            pitch: ROUTE_PITCH,
          }}
          center={fit.center}
          zoom={fit.zoom}
          pitch={ROUTE_PITCH}
          duration={800}
          easing="ease"
        />

        {/* Declared before the route source so it draws beneath the line —
          a halo around the out-of-sun stretches, not a cover over them. */}
        {shadeGeoJSON && (
          <GeoJSONSource id="shade" data={shadeGeoJSON}>
            <Layer
              id="shade-halo"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': chrome.textSecondary,
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 15],
                'line-opacity': 0.8,
              }}
            />
          </GeoJSONSource>
        )}

        <GeoJSONSource
          key={`route:${routeRenderKey}`}
          id="route"
          data={routeGeoJSON}
          lineMetrics
          onPress={
            routePressEnabled
              ? (event) => {
                  event.stopPropagation?.();
                  onRoutePress(event.nativeEvent.lngLat);
                }
              : undefined
          }
          hitbox={routePressEnabled ? { top: 22, bottom: 22, left: 22, right: 22 } : undefined}
        >
          <Layer
            id="route-glow"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': chrome.route,
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 17],
              'line-opacity': themeName === 'dark' ? 0.16 : 0.1,
              'line-blur': 4,
            }}
          />
          <Layer
            id="route-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': chrome.routeCasing,
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6.5, 15, 11.5],
            }}
          />
          <Layer
            id="route-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.75, 15, 7.25],
              'line-color': chrome.route,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="markers" data={markerGeoJSON}>
          <Layer
            id="markers-dot"
            type="circle"
            minzoom={10.5}
            paint={{
              'circle-radius': 7,
              'circle-color': chrome.cockpitRaised,
              'circle-stroke-color': chrome.cockpitTextSecondary,
              'circle-stroke-width': 1,
              'circle-opacity': 0.96,
            }}
          />
          <Layer
            id="markers-label"
            type="symbol"
            minzoom={11.5}
            layout={{
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 9.5,
              'text-anchor': 'center',
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': chrome.cockpitText,
            }}
          />
        </GeoJSONSource>

        <Marker lngLat={startLngLat} anchor="center">
          <EndpointBadge kind={isLoop ? 'loop' : 'start'} chrome={chrome} />
        </Marker>
        {!isLoop ? (
          <Marker lngLat={finishLngLat} anchor="center">
            <EndpointBadge kind="finish" chrome={chrome} />
          </Marker>
        ) : null}

        {showFocusMarker ? (
          <Marker lngLat={dotLngLat} anchor="center">
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: chrome.text,
                  borderColor: chrome.surfaceRaised,
                },
              ]}
            />
          </Marker>
        ) : null}
      </MLMap>

      {cameraMoved ? (
        <View style={[styles.restore, { bottom: bottomInset + SP[3] }]}>
          <IconButton
            name="fit"
            label="Fit route on map"
            chrome={chrome}
            onPress={restoreRouteFrame}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  restore: { position: 'absolute', right: SP[4] },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    shadowColor: SHADOW.color,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  endpoint: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: SHADOW.color,
    shadowOpacity: 0.32,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  loopEndpoint: { width: 34, borderRadius: 13 },
  endpointLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  loopEndpointLabel: { fontSize: 8.5, letterSpacing: 0.4 },
});
