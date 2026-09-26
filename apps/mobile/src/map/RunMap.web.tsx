import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { hoverBus, positionAt, type Route, type RouteConditionsProfile } from '@runcast/core';
import type { ThemeName } from '../state';
import type { Chrome } from '../theme';
import { SP, TYPE } from '../theme';

interface Props {
  route: Route;
  profile: RouteConditionsProfile | null;
  themeName: ThemeName;
  chrome: Chrome;
  units: 'metric' | 'imperial';
  bottomInset: number;
  shadeHighlight: boolean;
  showFocusMarker?: boolean;
  routePressEnabled?: boolean;
}

interface Point {
  x: number;
  y: number;
}

function projectRoute(
  route: Route,
  width: number,
  height: number,
  topInset: number,
  bottomInset: number,
): {
  path: string;
  start: Point;
  finish: Point;
  project: (lat: number, lon: number) => Point;
} | null {
  if (width <= 0 || height <= 0 || route.points.length === 0) return null;
  const meanLat = route.points.reduce((sum, point) => sum + point.lat, 0) / route.points.length;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const coordinates = route.points.map((point) => ({ x: point.lon * lonScale, y: point.lat }));
  const minX = Math.min(...coordinates.map((point) => point.x));
  const maxX = Math.max(...coordinates.map((point) => point.x));
  const minY = Math.min(...coordinates.map((point) => point.y));
  const maxY = Math.max(...coordinates.map((point) => point.y));
  const horizontalPadding = 36;
  const visibleHeight = Math.max(height - topInset - bottomInset, 80);
  const availableWidth = Math.max(width - horizontalPadding * 2, 80);
  const availableHeight = Math.max(visibleHeight - SP[5] * 2, 80);
  const spanX = Math.max(maxX - minX, 1e-7);
  const spanY = Math.max(maxY - minY, 1e-7);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const originX = (width - drawnWidth) / 2;
  const originY = topInset + (visibleHeight - drawnHeight) / 2;
  const project = (lat: number, lon: number): Point => ({
    x: originX + (lon * lonScale - minX) * scale,
    y: originY + (maxY - lat) * scale,
  });
  const points = route.points.map((point) => project(point.lat, point.lon));
  return {
    path: points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' '),
    start: points[0],
    finish: points.at(-1)!,
    project,
  };
}

/**
 * Lightweight web route field. MapLibre React Native is native-only, so the
 * web target keeps the same decision hierarchy with an abstract, scaled route
 * instead of crashing while importing the native map view.
 */
export function RunMap({ route, chrome, bottomInset, showFocusMarker = true }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [focusedDistance, setFocusedDistance] = useState<number | null>(hoverBus.value.distance);
  useEffect(() => hoverBus.subscribe(({ distance }) => setFocusedDistance(distance)), []);
  useEffect(() => setFocusedDistance(null), [route.id]);

  const geometry = useMemo(
    () => projectRoute(route, size.width, size.height, 92, bottomInset + SP[3]),
    [bottomInset, route, size.height, size.width],
  );
  const focusPosition =
    geometry && focusedDistance !== null ? positionAt(route, focusedDistance).position : null;
  const focus =
    geometry && focusPosition ? geometry.project(focusPosition.lat, focusPosition.lon) : null;

  function measure(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.frame, { backgroundColor: chrome.bg }]}
      onLayout={measure}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Route overview for ${route.name}`}
    >
      <View style={[styles.fieldGlow, { backgroundColor: chrome.surface }]} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        {[0.16, 0.32, 0.48, 0.64, 0.8].map((fraction) => (
          <Line
            key={`vertical-${fraction}`}
            x1={size.width * fraction}
            y1={0}
            x2={size.width * fraction}
            y2={size.height}
            stroke={chrome.border}
            strokeWidth={1}
          />
        ))}
        {[0.14, 0.28, 0.42, 0.56, 0.7, 0.84].map((fraction) => (
          <Line
            key={`horizontal-${fraction}`}
            x1={0}
            y1={size.height * fraction}
            x2={size.width}
            y2={size.height * fraction}
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
              strokeWidth={11}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d={geometry.path}
              fill="none"
              stroke={chrome.route}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={geometry.start.x} cy={geometry.start.y} r={7} fill={chrome.route} />
            <Circle
              cx={geometry.finish.x}
              cy={geometry.finish.y}
              r={7}
              fill={chrome.surfaceRaised}
              stroke={chrome.text}
              strokeWidth={3}
            />
            {showFocusMarker && focus ? (
              <Circle
                cx={focus.x}
                cy={focus.y}
                r={8}
                fill={chrome.text}
                stroke={chrome.surfaceRaised}
                strokeWidth={3}
              />
            ) : null}
          </>
        ) : null}
      </Svg>
      <View style={styles.northMarker} pointerEvents="none">
        <Text style={[TYPE.label, { color: chrome.textFaint }]}>N</Text>
        <View style={[styles.northLine, { backgroundColor: chrome.textFaint }]} />
      </View>
      <Text style={[styles.fieldLabel, { color: chrome.textFaint }]} pointerEvents="none">
        ROUTE FIELD / WEB
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  fieldGlow: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    top: -120,
    right: -160,
    opacity: 0.7,
  },
  northMarker: {
    position: 'absolute',
    right: SP[4],
    top: SP[5],
    alignItems: 'center',
    gap: SP[1],
  },
  northLine: { width: 1, height: 24 },
  fieldLabel: { ...TYPE.axis, position: 'absolute', left: SP[4], top: SP[5] },
});
