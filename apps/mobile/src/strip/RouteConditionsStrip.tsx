/** Shared route-condition drawing with compact Explorer and interactive Planner presentations. */
import { Canvas, Path, Rect, Skia } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  fmtTemp,
  hoverBus,
  presentRouteConditionsProfile,
  type RouteConditionsProfile,
  type SunlightIntensityLevel,
  type TemperatureUnit,
} from '@runcast/core';
import type { Chrome } from '../theme';
import { RADIUS, SP, TYPE } from '../theme';
import {
  ROUTE_PROGRESS_STEPS,
  alongRouteLanes,
  routeDistanceForBucket,
  routeProgressBucket,
} from '../cards/alongRouteModel';
import {
  buildSunExposureDisplayBands,
  forecastSunlightOpacity,
  windPlotSample,
} from '@runcast/core';

const LABEL_W = 56;
const VALUE_W = 42;
const PLOT_PAD = 2;
const RAIN_RATE_DOMAIN_MM_H = 10;

type Variant = 'compact' | 'interactive';
interface LaneLayout {
  sun: { y: number; h: number };
  air: { y: number; h: number };
  rain: { y: number; h: number };
  wind: { y: number; h: number };
  hills?: { y: number; h: number };
  axisY: number;
  height: number;
}

const COMPACT_LAYOUT: LaneLayout = {
  sun: { y: 10, h: 18 },
  air: { y: 42, h: 34 },
  rain: { y: 83, h: 14 },
  wind: { y: 104, h: 28 },
  axisY: 136,
  height: 150,
};

const INTERACTIVE_LAYOUT: LaneLayout = {
  air: { y: 12, h: 36 },
  sun: { y: 58, h: 20 },
  wind: { y: 88, h: 28 },
  rain: { y: 126, h: 18 },
  hills: { y: 154, h: 18 },
  axisY: 175,
  height: 188,
};

const INTERACTIVE_LAYOUT_NO_HILLS: LaneLayout = {
  air: INTERACTIVE_LAYOUT.air,
  sun: INTERACTIVE_LAYOUT.sun,
  wind: INTERACTIVE_LAYOUT.wind,
  rain: INTERACTIVE_LAYOUT.rain,
  axisY: 153,
  height: 166,
};

function scaleLaneLayout(layout: LaneLayout, height: number): LaneLayout {
  const scale = height / layout.height;
  const scaleLane = ({ y, h }: { y: number; h: number }) => ({
    y: y * scale,
    h: h * scale,
  });
  return {
    sun: scaleLane(layout.sun),
    air: scaleLane(layout.air),
    rain: scaleLane(layout.rain),
    wind: scaleLane(layout.wind),
    hills: layout.hills ? scaleLane(layout.hills) : undefined,
    axisY: layout.axisY * scale,
    height,
  };
}

export const STRIP_HEIGHT = INTERACTIVE_LAYOUT.height;
export const COMPACT_STRIP_HEIGHT = COMPACT_LAYOUT.height;

interface Props {
  profile: RouteConditionsProfile | null;
  chrome: Chrome;
  temperatureUnit: TemperatureUnit;
  variant?: Variant;
}

interface Drawing {
  forecastSunlightBands: DrawingBand<SunlightIntensityLevel>[];
  rainProbabilityAreaPath: string;
  rainIntensityAreaPath: string;
  crosswindTickPath: string;
  headwindAreaPath: string;
  tailwindAreaPath: string;
  elevationAreaPath: string | null;
  elevationLinePath: string | null;
  airTemperaturePath: string;
  minTemp: number;
  maxTemp: number;
  maxRain: number;
}

interface DrawingBand<T> {
  x: number;
  width: number;
  value: T;
}

function selectionHaptic(): void {
  const feedback =
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Frequent_Tick)
      : Haptics.selectionAsync();
  void feedback.catch(() => {});
}

function buildDrawing(profile: RouteConditionsProfile, width: number, lanes: LaneLayout): Drawing {
  const plotLeft = LABEL_W + PLOT_PAD;
  const plotRight = width - VALUE_W - PLOT_PAD;
  const plotW = Math.max(plotRight - plotLeft, 1);
  const samples = profile.samples;
  const total = samples[samples.length - 1].distanceM || 1;
  const x = (distanceM: number) => plotLeft + (distanceM / total) * plotW;

  const forecastSunlightBands = buildSunExposureDisplayBands(
    samples,
    profile.canopy?.modelMode ?? 'off',
  ).map((band) => ({
    x: x(band.startDistanceM),
    width: Math.max(x(band.endDistanceM) - x(band.startDistanceM), 0),
    value: band.segmentDisplay.forecastSunlight
      ? band.segmentDisplay.intensityLevel
      : ('none' as const),
  }));

  const temps = samples.map((sample) => sample.airTemperatureC);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const tempMid = (minTemp + maxTemp) / 2;
  const tempSpan = Math.max(maxTemp - minTemp, 6);
  const domainMin = tempMid - tempSpan / 2;
  const domainMax = tempMid + tempSpan / 2;
  const tempY = (value: number) =>
    lanes.air.y + 4 + (1 - (value - domainMin) / (domainMax - domainMin)) * (lanes.air.h - 8);
  const airTemperaturePath = samples
    .map(
      (sample, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(sample.distanceM)} ${tempY(sample.airTemperatureC)}`,
    )
    .join(' ');

  const maxRain = Math.max(...samples.map((sample) => sample.precipitationProbabilityPct));
  const rainParts = [`M ${x(0)} ${lanes.rain.y + lanes.rain.h}`];
  for (const sample of samples) {
    const y =
      lanes.rain.y + lanes.rain.h - (sample.precipitationProbabilityPct / 100) * lanes.rain.h;
    rainParts.push(`L ${x(sample.distanceM)} ${y}`);
  }
  rainParts.push(`L ${x(total)} ${lanes.rain.y + lanes.rain.h} Z`);
  const rainRateParts = [`M ${x(0)} ${lanes.rain.y + lanes.rain.h}`];
  for (const sample of samples) {
    const fraction = Math.min(sample.precipitationRateMmH / RAIN_RATE_DOMAIN_MM_H, 1);
    const y = lanes.rain.y + lanes.rain.h - fraction * lanes.rain.h;
    rainRateParts.push(`L ${x(sample.distanceM)} ${y}`);
  }
  rainRateParts.push(`L ${x(total)} ${lanes.rain.y + lanes.rain.h} Z`);

  // The current wind picture is forecast ambient wind relative to the
  // runner's heading. Headwind rises above calm; tailwind falls below. Small
  // signed ticks retain left/right crosswind without turning it into effort.
  const windMid = lanes.wind.y + lanes.wind.h / 2;
  const windHalf = lanes.wind.h / 2 - 1.5;
  const headParts = [`M ${x(0)} ${windMid}`];
  const tailParts = [`M ${x(0)} ${windMid}`];
  const crossParts: string[] = [];
  const crossTickStride = Math.max(1, Math.ceil(samples.length / 24));
  for (const [index, sample] of samples.entries()) {
    const px = x(sample.distanceM);
    const windPlot = windPlotSample(sample);
    headParts.push(`L ${px} ${windMid - windPlot.headFraction * windHalf}`);
    tailParts.push(`L ${px} ${windMid + windPlot.tailFraction * windHalf}`);
    if (
      (index % crossTickStride === 0 || index === samples.length - 1) &&
      windPlot.crossDirection !== 0 &&
      windPlot.crossFraction >= 0.08
    ) {
      crossParts.push(
        `M ${px} ${windMid} L ${px - windPlot.crossDirection * 2.5} ${windMid - windPlot.crossDirection * windPlot.crossFraction * windHalf * 0.5}`,
      );
    }
  }
  headParts.push(`L ${x(total)} ${windMid} Z`);
  tailParts.push(`L ${x(total)} ${windMid} Z`);
  const crosswindTickPath = crossParts.join(' ');

  let elevationAreaPath: string | null = null;
  let elevationLinePath: string | null = null;
  if (lanes.hills) {
    const elevations = samples.map((sample) => sample.elevationM);
    if (elevations.some((elevation) => elevation === null)) {
      return {
        forecastSunlightBands,
        rainProbabilityAreaPath: rainParts.join(' '),
        rainIntensityAreaPath: rainRateParts.join(' '),
        crosswindTickPath,
        headwindAreaPath: headParts.join(' '),
        tailwindAreaPath: tailParts.join(' '),
        elevationAreaPath,
        elevationLinePath,
        airTemperaturePath,
        minTemp,
        maxTemp,
        maxRain,
      };
    }
    const numericElevations = elevations as number[];
    const elevationMin = Math.min(...numericElevations);
    const elevationSpan = Math.max(Math.max(...numericElevations) - elevationMin, 20);
    const elevationY = (elevation: number) =>
      lanes.hills!.y +
      lanes.hills!.h -
      ((elevation - elevationMin) / elevationSpan) * (lanes.hills!.h - 3);
    const lineParts: string[] = [];
    const fillParts = [`M ${x(0)} ${lanes.hills.y + lanes.hills.h}`];
    samples.forEach((sample, index) => {
      const command = `${index === 0 ? 'M' : 'L'} ${x(sample.distanceM)} ${elevationY(sample.elevationM!)}`;
      lineParts.push(command);
      fillParts.push(`L ${x(sample.distanceM)} ${elevationY(sample.elevationM!)}`);
    });
    fillParts.push(`L ${x(total)} ${lanes.hills.y + lanes.hills.h} Z`);
    elevationAreaPath = fillParts.join(' ');
    elevationLinePath = lineParts.join(' ');
  }

  return {
    forecastSunlightBands,
    rainProbabilityAreaPath: rainParts.join(' '),
    rainIntensityAreaPath: rainRateParts.join(' '),
    crosswindTickPath,
    headwindAreaPath: headParts.join(' '),
    tailwindAreaPath: tailParts.join(' '),
    elevationAreaPath,
    elevationLinePath,
    airTemperaturePath,
    minTemp,
    maxTemp,
    maxRain,
  };
}

export function RouteConditionsStrip({
  profile,
  chrome,
  temperatureUnit,
  variant = 'interactive',
}: Props) {
  const showHills = profile ? alongRouteLanes(profile).includes('hills') : true;
  const baseLanes =
    variant === 'compact'
      ? COMPACT_LAYOUT
      : showHills
        ? INTERACTIVE_LAYOUT
        : INTERACTIVE_LAYOUT_NO_HILLS;
  const [size, setSize] = useState({ width: 0, height: baseLanes.height });
  const lanes = useMemo(
    () => (variant === 'compact' ? scaleLaneLayout(baseLanes, size.height) : baseLanes),
    [baseLanes, size.height, variant],
  );
  const width = size.width;
  const [cursorX, setCursorX] = useState<number | null>(null);
  const drawing = useMemo(
    () => (profile && width > 0 ? buildDrawing(profile, width, lanes) : null),
    [profile, width, lanes],
  );
  const summary = useMemo(
    () => (profile ? presentRouteConditionsProfile(profile) : null),
    [profile],
  );

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const widthRef = useRef(width);
  widthRef.current = width;
  const focusedDistanceRef = useRef<number | null>(hoverBus.value.distance);
  const hapticBucketRef = useRef<number | null>(null);

  useEffect(() => {
    if (variant !== 'interactive') {
      setCursorX(null);
      return;
    }
    return hoverBus.subscribe(({ distance }) => {
      focusedDistanceRef.current = distance;
      const currentProfile = profileRef.current;
      const currentWidth = widthRef.current;
      if (distance === null || !currentProfile || currentWidth === 0) {
        setCursorX(null);
        return;
      }
      const total = currentProfile.samples[currentProfile.samples.length - 1].distanceM || 1;
      const plotLeft = LABEL_W + PLOT_PAD;
      const plotRight = currentWidth - VALUE_W - PLOT_PAD;
      setCursorX(plotLeft + (distance / total) * (plotRight - plotLeft));
    });
  }, [variant]);

  function publishDistance(distance: number, withHaptic: boolean): void {
    const currentProfile = profileRef.current;
    if (!currentProfile) return;
    const total = currentProfile.samples[currentProfile.samples.length - 1].distanceM || 1;
    const nextDistance = Math.min(Math.max(distance, 0), total);
    if (withHaptic) {
      const bucket = routeProgressBucket(nextDistance, total);
      if (bucket !== hapticBucketRef.current) {
        hapticBucketRef.current = bucket;
        selectionHaptic();
      }
    }
    hoverBus.publish({ distance: nextDistance, source: 'strip' });
  }

  function publishAtX(px: number): void {
    const currentProfile = profileRef.current;
    const currentWidth = widthRef.current;
    if (!currentProfile || currentWidth === 0) return;
    const plotLeft = LABEL_W + PLOT_PAD;
    const plotRight = currentWidth - VALUE_W - PLOT_PAD;
    const fraction = (px - plotLeft) / (plotRight - plotLeft);
    const total = currentProfile.samples[currentProfile.samples.length - 1].distanceM || 1;
    publishDistance(Math.min(Math.max(fraction, 0), 1) * total, true);
  }

  function nudgeFocusedDistance(direction: -1 | 1): void {
    const currentProfile = profileRef.current;
    if (!currentProfile) return;
    const total = currentProfile.samples[currentProfile.samples.length - 1].distanceM || 1;
    const bucket = routeProgressBucket(focusedDistanceRef.current ?? 0, total);
    publishDistance(routeDistanceForBucket(bucket + direction, total, ROUTE_PROGRESS_STEPS), true);
  }

  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Pan()
          .activeOffsetX([-8, 8])
          .failOffsetY([-14, 14])
          .runOnJS(true)
          .onBegin(() => {
            hapticBucketRef.current = null;
          })
          .onStart((event) => publishAtX(event.x))
          .onUpdate((event) => publishAtX(event.x)),
        Gesture.Tap()
          .maxDuration(300)
          .runOnJS(true)
          .onBegin(() => {
            hapticBucketRef.current = null;
          })
          .onEnd((event) => publishAtX(event.x)),
      ),
    // Refs keep the gesture stable while plan and layout measurements change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const plotLeft = LABEL_W + PLOT_PAD;
  const plotRight = Math.max(width - VALUE_W - PLOT_PAD, plotLeft);
  const content = (
    <View
      style={[
        styles.wrap,
        variant === 'compact'
          ? styles.compactWrap
          : [styles.interactiveWrap, { height: lanes.height }],
        { backgroundColor: chrome.surfaceRaised, borderColor: chrome.border },
      ]}
      onLayout={(event) => {
        const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
        setSize((current) =>
          current.width === nextWidth && current.height === nextHeight
            ? current
            : { width: nextWidth, height: nextHeight },
        );
      }}
      accessible
      accessibilityRole={variant === 'interactive' ? 'adjustable' : 'image'}
      accessibilityActions={
        variant === 'interactive'
          ? [
              { name: 'decrement', label: 'Move toward the start' },
              { name: 'increment', label: 'Move toward the finish' },
            ]
          : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'decrement') nudgeFocusedDistance(-1);
        if (event.nativeEvent.actionName === 'increment') nudgeFocusedDistance(1);
      }}
      accessibilityLabel={
        variant === 'interactive'
          ? 'Conditions along the run. Air temperature, forecast sunlight, runner-relative wind, rain, and available elevation are shown from start to finish. Swipe up or down to move through the route.'
          : 'Conditions along the route. Air temperature, forecast sunlight, runner-relative wind, and rain are shown from start to finish.'
      }
    >
      {drawing && width > 0 ? (
        <>
          <Canvas style={{ width, height: lanes.height }}>
            <Rect
              x={plotLeft}
              y={lanes.sun.y}
              width={plotRight - plotLeft}
              height={lanes.sun.h}
              color={chrome.surfaceMuted}
            />
            <Rect
              x={plotLeft}
              y={lanes.air.y}
              width={plotRight - plotLeft}
              height={lanes.air.h}
              color={chrome.surfaceMuted}
              opacity={0.5}
            />
            <Rect
              x={plotLeft}
              y={lanes.rain.y}
              width={plotRight - plotLeft}
              height={lanes.rain.h}
              color={chrome.surfaceMuted}
            />
            <Rect
              x={plotLeft}
              y={lanes.wind.y}
              width={plotRight - plotLeft}
              height={lanes.wind.h}
              color={chrome.surfaceMuted}
              opacity={0.62}
            />
            {lanes.hills ? (
              <Rect
                x={plotLeft}
                y={lanes.hills.y}
                width={plotRight - plotLeft}
                height={lanes.hills.h}
                color={chrome.surfaceMuted}
                opacity={0.62}
              />
            ) : null}

            {drawing.forecastSunlightBands.map((band, index) =>
              band.value !== 'none' ? (
                <Rect
                  key={`sun-${index}`}
                  x={band.x}
                  y={lanes.sun.y}
                  width={band.width}
                  height={lanes.sun.h}
                  color={chrome.sun}
                  opacity={forecastSunlightOpacity(band.value)}
                />
              ) : null,
            )}

            <Rect
              x={plotLeft}
              y={lanes.air.y + lanes.air.h / 2}
              width={plotRight - plotLeft}
              height={1}
              color={chrome.border}
            />
            <Path
              path={Skia.Path.MakeFromSVGString(drawing.airTemperaturePath)!}
              color={chrome.temperature}
              style="stroke"
              strokeWidth={2.75}
              strokeCap="round"
              strokeJoin="round"
            />
            <Path
              path={Skia.Path.MakeFromSVGString(drawing.rainProbabilityAreaPath)!}
              color={chrome.rain}
              opacity={0.28}
            />
            <Path
              path={Skia.Path.MakeFromSVGString(drawing.rainIntensityAreaPath)!}
              color={chrome.rain}
              opacity={0.72}
            />
            <Rect
              x={plotLeft}
              y={lanes.wind.y + lanes.wind.h / 2}
              width={plotRight - plotLeft}
              height={1}
              color={chrome.borderStrong}
            />
            <Path
              path={Skia.Path.MakeFromSVGString(drawing.headwindAreaPath)!}
              color={chrome.wind}
              opacity={0.9}
            />
            <Path
              path={Skia.Path.MakeFromSVGString(drawing.tailwindAreaPath)!}
              color={chrome.wind}
              opacity={0.48}
            />
            {drawing.crosswindTickPath ? (
              <Path
                path={Skia.Path.MakeFromSVGString(drawing.crosswindTickPath)!}
                color={chrome.windInk}
                opacity={0.7}
                style="stroke"
                strokeWidth={1.2}
                strokeCap="round"
              />
            ) : null}
            {drawing.elevationAreaPath ? (
              <Path
                path={Skia.Path.MakeFromSVGString(drawing.elevationAreaPath)!}
                color={chrome.elevation}
                opacity={0.32}
              />
            ) : null}
            {drawing.elevationLinePath ? (
              <Path
                path={Skia.Path.MakeFromSVGString(drawing.elevationLinePath)!}
                color={chrome.elevation}
                opacity={0.92}
                style="stroke"
                strokeWidth={1.5}
              />
            ) : null}
          </Canvas>

          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[
              styles.laneLabel,
              {
                top: lanes.sun.y + Math.max((lanes.sun.h - 14) / 2, 0),
                color: chrome.sunInk,
              },
            ]}
          >
            SUN
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[
              styles.laneLabel,
              {
                top: lanes.air.y + lanes.air.h / 2 - 7,
                color: chrome.temperatureInk,
              },
            ]}
          >
            AIR
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[styles.laneLabel, { top: lanes.rain.y, color: chrome.rainInk }]}
          >
            RAIN
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[
              styles.laneLabel,
              {
                top: lanes.wind.y + Math.max((lanes.wind.h - 14) / 2, 0),
                color: chrome.windInk,
              },
            ]}
          >
            WIND
          </Text>
          {lanes.hills ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1}
              style={[
                styles.laneLabel,
                {
                  top: lanes.hills.y + Math.max((lanes.hills.h - 14) / 2, 0),
                  color: chrome.elevationInk,
                },
              ]}
            >
              HILLS
            </Text>
          ) : null}

          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[
              styles.sunIntensityValue,
              {
                top: lanes.sun.y + Math.max((lanes.sun.h - 12) / 2, 0),
                color: chrome.sunInk,
              },
            ]}
          >
            {summary
              ? (
                  {
                    none: 'NONE',
                    minimal: 'MIN',
                    low: 'LOW',
                    moderate: 'MOD',
                    high: 'HIGH',
                  } as const
                )[summary.forecastSunlight.level]
              : '—'}
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[styles.value, { top: lanes.air.y, color: chrome.temperatureInk }]}
          >
            {fmtTemp(drawing.maxTemp, temperatureUnit)}
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[
              styles.value,
              {
                top: lanes.air.y + lanes.air.h - 15,
                color: chrome.temperatureInk,
              },
            ]}
          >
            {fmtTemp(drawing.minTemp, temperatureUnit)}
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[styles.value, { top: lanes.rain.y - 1, color: chrome.rainInk }]}
          >
            {Math.round(drawing.maxRain)}%
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              styles.windKey,
              {
                top: lanes.wind.y - (variant === 'compact' ? 1 : 3),
                color: chrome.windInk,
              },
            ]}
          >
            HEAD
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              styles.windKey,
              {
                top: lanes.wind.y + lanes.wind.h - (variant === 'compact' ? 9 : 10),
                color: chrome.windInk,
              },
            ]}
          >
            TAIL
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[styles.axis, { top: lanes.axisY, left: plotLeft, color: chrome.textFaint }]}
          >
            START
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            style={[
              styles.axis,
              {
                top: lanes.axisY,
                right: VALUE_W + PLOT_PAD,
                color: chrome.textFaint,
              },
            ]}
          >
            FINISH
          </Text>
        </>
      ) : (
        <View style={[styles.empty, { backgroundColor: chrome.surfaceMuted }]} />
      )}

      {variant === 'interactive' && cursorX !== null ? (
        <View
          pointerEvents="none"
          style={[
            styles.cursor,
            {
              top: lanes.air.y,
              bottom: lanes.height - lanes.axisY + 8,
              left: cursorX - 1,
              backgroundColor: chrome.accentInk,
            },
          ]}
        >
          <View
            style={[
              styles.cursorHandle,
              {
                backgroundColor: chrome.surfaceRaised,
                borderColor: chrome.accentInk,
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );

  return variant === 'interactive' ? (
    <GestureDetector gesture={gesture}>{content}</GestureDetector>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  interactiveWrap: {
    borderWidth: 0,
    borderRadius: RADIUS.lg,
  },
  compactWrap: { height: COMPACT_STRIP_HEIGHT },
  laneLabel: {
    position: 'absolute',
    left: SP[3],
    width: LABEL_W - SP[3],
    ...TYPE.label,
  },
  value: {
    position: 'absolute',
    right: SP[2],
    width: VALUE_W - SP[2],
    textAlign: 'right',
    ...TYPE.caption,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  windKey: {
    position: 'absolute',
    right: SP[2],
    width: VALUE_W - SP[2],
    textAlign: 'right',
    ...TYPE.axis,
    fontSize: 8,
    lineHeight: 9,
  },
  sunIntensityValue: {
    position: 'absolute',
    right: SP[2],
    width: VALUE_W - SP[2],
    textAlign: 'right',
    ...TYPE.axis,
    fontSize: 8,
    fontWeight: '600',
    lineHeight: 9,
    fontVariant: ['tabular-nums'],
  },
  axis: {
    position: 'absolute',
    ...TYPE.axis,
  },
  cursor: { position: 'absolute', width: 2 },
  cursorHandle: {
    position: 'absolute',
    top: -5,
    left: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  empty: { margin: SP[3], flex: 1, borderRadius: RADIUS.md },
});
