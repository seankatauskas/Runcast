import { fmtTemp, type RouteConditionsProfile, type TemperatureUnit } from '@runcast/core';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { alongRouteLanes } from '../cards/alongRouteModel';
import type { Chrome } from '../theme';
import { RADIUS, SP, TYPE } from '../theme';
import { windPlotSample } from '@runcast/core';

const LABEL_WIDTH = 56;
const VALUE_WIDTH = 42;
const PLOT_PADDING = 2;

type Variant = 'compact' | 'interactive';

interface Props {
  profile: RouteConditionsProfile | null;
  chrome: Chrome;
  temperatureUnit: TemperatureUnit;
  variant?: Variant;
}

interface Lane {
  y: number;
  height: number;
}

interface Layout {
  air: Lane;
  sun: Lane;
  wind: Lane;
  rain: Lane;
  hills?: Lane;
  axisY: number;
  height: number;
}

const COMPACT_LAYOUT: Layout = {
  sun: { y: 10, height: 18 },
  air: { y: 42, height: 34 },
  rain: { y: 83, height: 14 },
  wind: { y: 104, height: 28 },
  axisY: 136,
  height: 150,
};

const INTERACTIVE_LAYOUT: Layout = {
  air: { y: 12, height: 36 },
  sun: { y: 58, height: 20 },
  wind: { y: 88, height: 28 },
  rain: { y: 126, height: 18 },
  hills: { y: 154, height: 18 },
  axisY: 175,
  height: 188,
};

const INTERACTIVE_LAYOUT_NO_HILLS: Layout = {
  air: INTERACTIVE_LAYOUT.air,
  sun: INTERACTIVE_LAYOUT.sun,
  wind: INTERACTIVE_LAYOUT.wind,
  rain: INTERACTIVE_LAYOUT.rain,
  axisY: 153,
  height: 166,
};

export const STRIP_HEIGHT = INTERACTIVE_LAYOUT.height;
export const COMPACT_STRIP_HEIGHT = COMPACT_LAYOUT.height;

function linePath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function RouteConditionsStrip({
  profile,
  chrome,
  temperatureUnit,
  variant = 'interactive',
}: Props) {
  const showHills = profile ? alongRouteLanes(profile).includes('hills') : true;
  const layout =
    variant === 'compact'
      ? COMPACT_LAYOUT
      : showHills
        ? INTERACTIVE_LAYOUT
        : INTERACTIVE_LAYOUT_NO_HILLS;
  const [width, setWidth] = useState(0);

  const drawing = useMemo(() => {
    if (!profile || width <= LABEL_WIDTH + VALUE_WIDTH || profile.samples.length === 0) return null;
    const samples = profile.samples;
    const plotLeft = LABEL_WIDTH + PLOT_PADDING;
    const plotRight = width - VALUE_WIDTH - PLOT_PADDING;
    const plotWidth = plotRight - plotLeft;
    const total = samples.at(-1)?.distanceM || 1;
    const x = (distance: number) => plotLeft + (distance / total) * plotWidth;

    const temperatures = samples.map((sample) => sample.airTemperatureC);
    const minTemp = Math.min(...temperatures);
    const maxTemp = Math.max(...temperatures);
    const tempMid = (minTemp + maxTemp) / 2;
    const tempSpan = Math.max(maxTemp - minTemp, 6);
    const tempY = (value: number) =>
      layout.air.y +
      4 +
      (1 - (value - (tempMid - tempSpan / 2)) / tempSpan) * (layout.air.height - 8);
    const temperaturePoints = samples.map((sample) => ({
      x: x(sample.distanceM),
      y: tempY(sample.airTemperatureC),
    }));

    const rainBaseline = layout.rain.y + layout.rain.height;
    const rainPoints = samples.map((sample) => ({
      x: x(sample.distanceM),
      y:
        rainBaseline -
        Math.min(Math.max(sample.precipitationProbabilityPct / 100, 0), 1) * layout.rain.height,
    }));
    const windMid = layout.wind.y + layout.wind.height / 2;
    const windHalf = layout.wind.height / 2 - 1.5;
    const headPoints = samples.map((sample) => ({
      x: x(sample.distanceM),
      y: windMid - windPlotSample(sample).headFraction * windHalf,
    }));
    const tailPoints = samples.map((sample) => ({
      x: x(sample.distanceM),
      y: windMid + windPlotSample(sample).tailFraction * windHalf,
    }));
    let elevationAreaPath: string | null = null;
    let elevationLinePath: string | null = null;
    if (layout.hills) {
      const elevations = samples.map((sample) => sample.elevationM);
      if (elevations.every((elevation): elevation is number => elevation !== null)) {
        const minElevation = Math.min(...elevations);
        const elevationSpan = Math.max(Math.max(...elevations) - minElevation, 20);
        const elevationY = (elevation: number) =>
          layout.hills!.y +
          layout.hills!.height -
          ((elevation - minElevation) / elevationSpan) * (layout.hills!.height - 3);
        const elevationPoints = samples.map((sample) => ({
          x: x(sample.distanceM),
          y: elevationY(sample.elevationM!),
        }));
        elevationLinePath = linePath(elevationPoints);
        elevationAreaPath = `${linePath([{ x: plotLeft, y: layout.hills.y + layout.hills.height }, ...elevationPoints])} L ${plotRight} ${layout.hills.y + layout.hills.height} Z`;
      }
    }
    return {
      plotLeft,
      plotRight,
      total,
      x,
      minTemp,
      maxTemp,
      maxRain: Math.max(...samples.map((sample) => sample.precipitationProbabilityPct)),
      temperaturePath: linePath(temperaturePoints),
      rainPath: `${linePath([{ x: plotLeft, y: rainBaseline }, ...rainPoints])} L ${plotRight} ${rainBaseline} Z`,
      headwindPath: `${linePath([{ x: plotLeft, y: windMid }, ...headPoints])} L ${plotRight} ${windMid} Z`,
      tailwindPath: `${linePath([{ x: plotLeft, y: windMid }, ...tailPoints])} L ${plotRight} ${windMid} Z`,
      elevationAreaPath,
      elevationLinePath,
    };
  }, [layout, profile, width]);

  const lanes = [
    { name: 'AIR', lane: layout.air, color: chrome.temperatureInk },
    { name: 'SUN', lane: layout.sun, color: chrome.sunInk },
    { name: 'WIND', lane: layout.wind, color: chrome.windInk },
    { name: 'RAIN', lane: layout.rain, color: chrome.rainInk },
    ...(layout.hills ? [{ name: 'HILLS', lane: layout.hills, color: chrome.elevationInk }] : []),
  ];

  return (
    <View
      style={[
        styles.wrap,
        {
          height: layout.height,
          backgroundColor: chrome.surfaceRaised,
          borderColor: chrome.border,
        },
        variant === 'interactive' && styles.interactive,
      ]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Conditions along the route from start to finish: air temperature, sunlight, wind, rain, and available elevation."
    >
      {drawing ? (
        <>
          <Svg width={width} height={layout.height} style={StyleSheet.absoluteFill}>
            <Rect
              x={drawing.plotLeft}
              y={layout.sun.y}
              width={drawing.plotRight - drawing.plotLeft}
              height={layout.sun.height}
              fill={chrome.surfaceMuted}
            />
            <Rect
              x={drawing.plotLeft}
              y={layout.air.y}
              width={drawing.plotRight - drawing.plotLeft}
              height={layout.air.height}
              fill={chrome.surfaceMuted}
              opacity={0.5}
            />
            <Rect
              x={drawing.plotLeft}
              y={layout.rain.y}
              width={drawing.plotRight - drawing.plotLeft}
              height={layout.rain.height}
              fill={chrome.surfaceMuted}
            />
            <Rect
              x={drawing.plotLeft}
              y={layout.wind.y}
              width={drawing.plotRight - drawing.plotLeft}
              height={layout.wind.height}
              fill={chrome.surfaceMuted}
              opacity={0.62}
            />
            {layout.hills ? (
              <Rect
                x={drawing.plotLeft}
                y={layout.hills.y}
                width={drawing.plotRight - drawing.plotLeft}
                height={layout.hills.height}
                fill={chrome.surfaceMuted}
                opacity={0.62}
              />
            ) : null}
            {profile!.samples.slice(0, -1).map((sample, index) => {
              if (!sample.daylight || sample.radiationWm2 < 20) return null;
              const next = profile!.samples[index + 1];
              return (
                <Rect
                  key={`sun-${index}`}
                  x={drawing.x(sample.distanceM)}
                  y={layout.sun.y}
                  width={Math.max(drawing.x(next.distanceM) - drawing.x(sample.distanceM), 1)}
                  height={layout.sun.height}
                  fill={chrome.sun}
                  opacity={Math.min(0.28 + sample.radiationWm2 / 950, 1)}
                />
              );
            })}
            <Line
              x1={drawing.plotLeft}
              x2={drawing.plotRight}
              y1={layout.air.y + layout.air.height / 2}
              y2={layout.air.y + layout.air.height / 2}
              stroke={chrome.border}
            />
            <Path
              d={drawing.temperaturePath}
              fill="none"
              stroke={chrome.temperature}
              strokeWidth={2.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path d={drawing.rainPath} fill={chrome.rain} opacity={0.28} />
            <Line
              x1={drawing.plotLeft}
              x2={drawing.plotRight}
              y1={layout.wind.y + layout.wind.height / 2}
              y2={layout.wind.y + layout.wind.height / 2}
              stroke={chrome.borderStrong}
            />
            <Path d={drawing.headwindPath} fill={chrome.wind} opacity={0.9} />
            <Path d={drawing.tailwindPath} fill={chrome.wind} opacity={0.48} />
            {drawing.elevationAreaPath ? (
              <Path d={drawing.elevationAreaPath} fill={chrome.elevation} opacity={0.32} />
            ) : null}
            {drawing.elevationLinePath ? (
              <Path
                d={drawing.elevationLinePath}
                fill="none"
                stroke={chrome.elevation}
                strokeWidth={1.5}
              />
            ) : null}
          </Svg>

          {lanes.map(({ name, lane, color }) => (
            <Text
              key={name}
              maxFontSizeMultiplier={1}
              style={[styles.laneLabel, { top: lane.y + lane.height / 2 - 7, color }]}
            >
              {name}
            </Text>
          ))}
          <Text style={[styles.value, { top: layout.air.y, color: chrome.temperatureInk }]}>
            {fmtTemp(drawing.maxTemp, temperatureUnit)}
          </Text>
          <Text
            style={[
              styles.value,
              { top: layout.air.y + layout.air.height - 15, color: chrome.temperatureInk },
            ]}
          >
            {fmtTemp(drawing.minTemp, temperatureUnit)}
          </Text>
          <Text style={[styles.value, { top: layout.rain.y - 1, color: chrome.rainInk }]}>
            {Math.round(drawing.maxRain)}%
          </Text>
          <Text style={[styles.windKey, { top: layout.wind.y - 1, color: chrome.windInk }]}>
            HEAD
          </Text>
          <Text
            style={[
              styles.windKey,
              { top: layout.wind.y + layout.wind.height - 9, color: chrome.windInk },
            ]}
          >
            TAIL
          </Text>
          <Text
            style={[
              styles.axis,
              { top: layout.axisY, left: drawing.plotLeft, color: chrome.textFaint },
            ]}
          >
            START
          </Text>
          <Text
            style={[
              styles.axis,
              { top: layout.axisY, right: VALUE_WIDTH + PLOT_PADDING, color: chrome.textFaint },
            ]}
          >
            FINISH
          </Text>
        </>
      ) : (
        <View style={[styles.empty, { backgroundColor: chrome.surfaceMuted }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  interactive: { borderWidth: 0, borderRadius: RADIUS.lg },
  laneLabel: {
    position: 'absolute',
    left: SP[3],
    width: LABEL_WIDTH - SP[3],
    ...TYPE.label,
  },
  value: {
    position: 'absolute',
    right: SP[2],
    width: VALUE_WIDTH - SP[2],
    textAlign: 'right',
    ...TYPE.caption,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  windKey: {
    position: 'absolute',
    right: SP[2],
    width: VALUE_WIDTH - SP[2],
    textAlign: 'right',
    ...TYPE.axis,
    fontSize: 8,
    lineHeight: 9,
  },
  axis: { position: 'absolute', ...TYPE.axis },
  empty: { margin: SP[3], flex: 1, borderRadius: RADIUS.md },
});
