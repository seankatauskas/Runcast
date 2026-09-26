import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { hoverBus, positionAt, type Route } from '@runcast/core';
import type { Planner } from '../state';
import type { Chrome } from '../theme';
import { RADIUS } from '../theme';

const DEFAULT_HEIGHT = 132;

interface Props {
  route: Route;
  chrome: Chrome;
  themeName: Planner['themeName'];
  focusedDistance?: number | null;
  height?: number;
}

function routeGeometry(route: Route, width: number, height: number) {
  if (width <= 0 || route.points.length === 0) return null;
  const meanLat = route.points.reduce((sum, point) => sum + point.lat, 0) / route.points.length;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const coordinates = route.points.map((point) => ({ x: point.lon * lonScale, y: point.lat }));
  const minX = Math.min(...coordinates.map((point) => point.x));
  const maxX = Math.max(...coordinates.map((point) => point.x));
  const minY = Math.min(...coordinates.map((point) => point.y));
  const maxY = Math.max(...coordinates.map((point) => point.y));
  const spanX = Math.max(maxX - minX, 1e-7);
  const spanY = Math.max(maxY - minY, 1e-7);
  const scale = Math.min((width - 36) / spanX, (height - 28) / spanY);
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const originX = (width - drawnWidth) / 2;
  const originY = (height - drawnHeight) / 2;
  const project = (lat: number, lon: number) => ({
    x: originX + (lon * lonScale - minX) * scale,
    y: originY + (maxY - lat) * scale,
  });
  const points = route.points.map((point) => project(point.lat, point.lon));
  return {
    path: points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' '),
    project,
  };
}

export function RouteThumbnail({ route, chrome, focusedDistance, height = DEFAULT_HEIGHT }: Props) {
  const [width, setWidth] = useState(0);
  const [busDistance, setBusDistance] = useState<number | null>(hoverBus.value.distance);
  useEffect(() => hoverBus.subscribe(({ distance }) => setBusDistance(distance)), []);
  useEffect(() => setBusDistance(null), [route.id]);
  const focused = focusedDistance === undefined ? busDistance : focusedDistance;
  const geometry = useMemo(() => routeGeometry(route, width, height), [height, route, width]);
  const focusPosition = focused === null ? null : positionAt(route, focused).position;
  const focus =
    geometry && focusPosition ? geometry.project(focusPosition.lat, focusPosition.lon) : null;

  function measure(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View
      style={[styles.wrap, { height, backgroundColor: chrome.surfaceMuted }]}
      onLayout={measure}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Route map for ${route.name}`}
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        {[0.25, 0.5, 0.75].map((fraction) => (
          <Line
            key={fraction}
            x1={width * fraction}
            y1={0}
            x2={width * fraction}
            y2={height}
            stroke={chrome.border}
            strokeWidth={1}
          />
        ))}
        {geometry ? (
          <>
            <Path
              d={geometry.path}
              fill="none"
              stroke={chrome.routeCasing}
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d={geometry.path}
              fill="none"
              stroke={chrome.route}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {focus ? (
              <Circle
                cx={focus.x}
                cy={focus.y}
                r={7}
                fill={chrome.surfaceRaised}
                stroke={chrome.accentInk}
                strokeWidth={3}
              />
            ) : null}
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: RADIUS.lg, overflow: 'hidden' },
});
