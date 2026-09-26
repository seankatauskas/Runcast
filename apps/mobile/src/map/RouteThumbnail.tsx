/** North-up, noninteractive mini-map linked to the shared focus channel. */
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MLMap,
  Marker,
  type LngLat,
} from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { hoverBus, positionAt, type Route } from '@runcast/core';
import type { Planner } from '../state';
import type { Chrome } from '../theme';
import { RADIUS, SHADOW } from '../theme';
import { thumbnailCameraForRoute } from './mapGeometry';
import { mobileMapStyle } from './mobileMapStyle';

const DEFAULT_HEIGHT = 132;

interface Props {
  route: Route;
  chrome: Chrome;
  themeName: Planner['themeName'];
  focusedDistance?: number | null;
  height?: number;
}

export function RouteThumbnail({
  route,
  chrome,
  themeName,
  focusedDistance,
  height = DEFAULT_HEIGHT,
}: Props) {
  const [width, setWidth] = useState(0);
  const [busDistance, setBusDistance] = useState<number | null>(hoverBus.value.distance);

  useEffect(() => hoverBus.subscribe(({ distance }) => setBusDistance(distance)), []);
  useEffect(() => setBusDistance(null), [route.id, route.points]);

  const focused = focusedDistance === undefined ? busDistance : focusedDistance;
  const camera = useMemo(
    () => thumbnailCameraForRoute(route.points, width, height),
    [height, route, width],
  );
  const routeGeoJSON = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: route.points.map((point) => [point.lon, point.lat] as [number, number]),
      },
    }),
    [route],
  );
  const focusPosition = focused === null ? null : positionAt(route, focused).position;
  const focus: LngLat | null = focusPosition ? [focusPosition.lon, focusPosition.lat] : null;
  const routeRenderKey = `${route.id}:${route.points[0].lat}:${route.points[0].lon}:${route.points.length}`;

  return (
    <View
      style={[styles.wrap, { height, backgroundColor: chrome.surfaceMuted }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`North-up route preview for ${route.name}`}
    >
      <MLMap
        key={`thumbnail-map:${routeRenderKey}`}
        style={StyleSheet.absoluteFill}
        mapStyle={mobileMapStyle(themeName)}
        pointerEvents="none"
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        doubleTapHoldZoom={false}
        touchRotate={false}
        touchPitch={false}
        compass={false}
        scaleBar={false}
        attribution={false}
        logo={false}
        preferredFramesPerSecond={30}
        androidView="texture"
      >
        {camera ? (
          <Camera
            key={`thumbnail-camera:${routeRenderKey}`}
            initialViewState={{
              center: camera.center,
              zoom: camera.zoom,
              bearing: 0,
              pitch: 0,
            }}
            center={camera.center}
            zoom={camera.zoom}
            bearing={0}
            pitch={0}
            duration={0}
          />
        ) : null}

        <GeoJSONSource
          key={`thumbnail-route:${routeRenderKey}`}
          id="thumbnail-route"
          data={routeGeoJSON}
        >
          <Layer
            id="thumbnail-route-glow"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': chrome.route,
              'line-width': 12,
              'line-opacity': themeName === 'dark' ? 0.16 : 0.1,
              'line-blur': 3,
            }}
          />
          <Layer
            id="thumbnail-route-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': chrome.routeCasing, 'line-width': 8 }}
          />
          <Layer
            id="thumbnail-route-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': chrome.route, 'line-width': 5 }}
          />
        </GeoJSONSource>

        {focus ? (
          <Marker lngLat={focus} anchor="center">
            <View
              style={[
                styles.focus,
                {
                  backgroundColor: chrome.surfaceRaised,
                  borderColor: chrome.accentInk,
                },
              ]}
            />
          </Marker>
        ) : null}
      </MLMap>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  focus: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    shadowColor: SHADOW.color,
    shadowOpacity: 0.24,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
});
