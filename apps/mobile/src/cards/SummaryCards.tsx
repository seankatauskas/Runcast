/**
 * Summary cards plus the FocusRow that mirrors the web popover: whatever
 * sample is focused (route tap, strip scrub, or the flyover) is described
 * here, updated straight from the hover bus. Severe-weather alerts live in
 * AlertBanner is presented separately by each screen.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  classifyRouteWind,
  fmtClock,
  fmtDistance,
  fmtTemp,
  fmtWindSpeed,
  hoverBus,
  presentRouteConditionsProfile,
  presentRunConditions,
  sunlightIntensityLevel,
  type RouteConditionsSample,
  type RouteWindStory,
  type UnitSystem,
} from '@runcast/core';
import type { Planner } from '../state';
import { ActionButton, Surface } from '../design/Primitives';
import { FAMILY, SP, TYPE } from '../theme';
import { alongRouteIdleStory, shouldShowFeelsLike } from './alongRouteModel';
import { planningUnavailableMessage } from './startRecommendationPresentation';

function pointForecastSunlightLabel(sample: RouteConditionsSample): string {
  const level = sunlightIntensityLevel(sample.radiationWm2, sample.daylight);
  return level === 'none' ? 'no forecast sun' : `${level} forecast sun`;
}

const ROUTE_WIND_STORY_COPY: Record<RouteWindStory, string> = {
  'headwind-out-tailwind-home': 'headwind out · tailwind home',
  'tailwind-out-headwind-home': 'tailwind out · headwind home',
  'mostly-headwind': 'mostly headwind',
  'mostly-tailwind': 'mostly tailwind',
  'mostly-crosswind': 'mostly crosswind',
  'mostly-calm': 'mostly calm',
  mixed: 'mixed wind',
};

function pointWindLabel(sample: RouteConditionsSample, units: UnitSystem): string {
  const windClass = classifyRouteWind(sample);
  const parts: string[] = [];
  if (windClass === 'calm') {
    parts.push('calm wind');
  } else if (windClass === 'headwind') {
    parts.push(`headwind ${fmtWindSpeed(sample.ambientHeadwindMs, units)}`);
  } else if (windClass === 'tailwind') {
    parts.push(`tailwind ${fmtWindSpeed(-sample.ambientHeadwindMs, units)}`);
  } else {
    parts.push(
      `crosswind from ${sample.ambientCrosswindMs >= 0 ? 'left' : 'right'} ${fmtWindSpeed(Math.abs(sample.ambientCrosswindMs), units)}`,
    );
  }
  if (windClass !== 'crosswind' && Math.abs(sample.ambientCrosswindMs) >= 1) {
    parts.push(
      `cross from ${sample.ambientCrosswindMs >= 0 ? 'left' : 'right'} ${fmtWindSpeed(Math.abs(sample.ambientCrosswindMs), units)}`,
    );
  }
  parts.push(`gusts ${fmtWindSpeed(sample.gustMs, units)}`);
  return parts.join(' · ');
}

function forecastSunLabel(level: string): string {
  if (level === 'none') return 'No forecast sun';
  return `${level[0].toUpperCase()}${level.slice(1)} forecast sun`;
}

export function CompactConditionsSummary({ planner }: { planner: Planner }) {
  const { chrome, routeConditionsProfile, units } = planner;
  if (!routeConditionsProfile) return null;
  const summary = presentRouteConditionsProfile(routeConditionsProfile);
  return (
    <Text
      numberOfLines={1}
      ellipsizeMode="tail"
      style={[styles.compactSummary, { color: chrome.textSecondary }]}
      accessibilityLabel={`${forecastSunLabel(summary.forecastSunlight.level)}. ${ROUTE_WIND_STORY_COPY[summary.wind.story]}. Gusts ${fmtWindSpeed(summary.wind.peakGustMs, units)}.`}
    >
      {forecastSunLabel(summary.forecastSunlight.level)} ·{' '}
      {ROUTE_WIND_STORY_COPY[summary.wind.story]} · gusts{' '}
      {fmtWindSpeed(summary.wind.peakGustMs, units)}
    </Text>
  );
}

/** The focused-sample readout — the mobile analog of the map popover. */
export function FocusRow({ planner }: { planner: Planner }) {
  const { fontScale } = useWindowDimensions();
  const accessibleText = fontScale >= 1.3;
  const {
    chrome,
    units,
    temperatureUnit,
    timezone,
    routeConditionsProfile,
    evaluatedRun,
    weatherAlerts,
  } = planner;
  const [sample, setSample] = useState<RouteConditionsSample | null>(null);
  const profileRef = useRef(routeConditionsProfile);
  profileRef.current = routeConditionsProfile;
  useEffect(() => {
    let raf = 0;
    return hoverBus.subscribe(({ distance }) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const profile = profileRef.current;
        if (distance === null || !profile) {
          setSample(null);
          return;
        }
        const total = profile.samples[profile.samples.length - 1].distanceM || 1;
        const i = Math.min(
          Math.round((distance / total) * (profile.samples.length - 1)),
          profile.samples.length - 1,
        );
        setSample(profile.samples[i]);
      });
    });
  }, []);

  // At rest, explain where this plan changes rather than repeating the
  // decision summary above it.
  if (!sample) {
    if (!routeConditionsProfile || !evaluatedRun) {
      return (
        <Text style={[TYPE.body, { color: chrome.textFaint, textAlign: 'center' }]}>
          {planner.weatherStatus === 'loading'
            ? 'Fetching the forecast…'
            : planningUnavailableMessage({
                weatherStatus: planner.weatherStatus,
                syncState: planner.planningBundleSyncState,
                environmentExpired: planner.environmentExpired,
                reasons: planner.planningUnavailableReasons,
              })}
        </Text>
      );
    }
    return (
      <View style={styles.focusRow}>
        <Text
          style={[styles.idleStory, { color: chrome.textSecondary }]}
          numberOfLines={accessibleText ? undefined : 2}
          ellipsizeMode="tail"
        >
          {alongRouteIdleStory(routeConditionsProfile, weatherAlerts, units)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.focusRow}>
      <View style={[styles.focusHeadline, accessibleText && styles.focusHeadlineAccessible]}>
        <Text style={[styles.focusTime, { color: chrome.text }]}>
          {fmtClock(sample.time, timezone)}
        </Text>
        <View style={[styles.focusDot, { backgroundColor: chrome.temperature }]} />
        <Text style={[styles.focusAir, { color: chrome.temperatureInk }]}>
          Air {fmtTemp(sample.airTemperatureC, temperatureUnit)}
        </Text>
        <Text
          style={[
            styles.focusDistance,
            accessibleText && styles.focusDistanceAccessible,
            { color: chrome.textFaint },
          ]}
        >
          {fmtDistance(sample.distanceM, units)}
        </Text>
      </View>
      <Text
        style={[styles.focusStory, { color: chrome.textSecondary }]}
        numberOfLines={accessibleText ? undefined : 2}
        ellipsizeMode="tail"
      >
        {shouldShowFeelsLike(sample.airTemperatureC, sample.feelsLikeC)
          ? `Feels ${fmtTemp(sample.feelsLikeC, temperatureUnit)} · `
          : ''}
        {pointForecastSunlightLabel(sample)} · {pointWindLabel(sample, units)}
        {sample.precipitationProbabilityPct >= 8
          ? ` · rain ${Math.round(sample.precipitationProbabilityPct)}%`
          : ''}
      </Text>
    </View>
  );
}

export function SummaryCards({ planner }: { planner: Planner }) {
  const { chrome, temperatureUnit, weatherStatus, retryWeather } = planner;
  const { fontScale } = useWindowDimensions();
  const accessibleText = fontScale >= 1.3;
  const factStyle = accessibleText ? styles.factAccessible : styles.fact;

  if (weatherStatus === 'error') {
    return (
      <Surface chrome={chrome}>
        <Text style={[styles.cardTitle, { color: chrome.textFaint }]}>FORECAST UNAVAILABLE</Text>
        <Text style={[TYPE.body, { color: chrome.textSecondary, marginVertical: SP[2] }]}>
          Open-Meteo didn’t answer. Check your connection and try again.
        </Text>
        <ActionButton label="Retry" chrome={chrome} onPress={retryWeather} />
      </Surface>
    );
  }

  if (planner.evaluatedRun) {
    const evaluatedRun = planner.evaluatedRun;
    const runConditions = presentRunConditions(evaluatedRun);
    const routeConditionSummary = planner.routeConditionsProfile
      ? presentRouteConditionsProfile(planner.routeConditionsProfile)
      : null;
    return (
      <Surface chrome={chrome} style={styles.factsGrid}>
        <View style={[factStyle, styles.factBottom, { borderColor: chrome.border }]}>
          <Text style={[styles.cardTitle, { color: chrome.textFaint }]}>RUN CONDITIONS</Text>
          <Text style={[styles.cardValue, { color: chrome.text }]}>
            {runConditions.overallLabel}
          </Text>
          <Text style={[TYPE.support, { color: chrome.textSecondary }]}>for this run</Text>
        </View>
        <View
          style={[
            factStyle,
            !accessibleText && styles.factLeft,
            styles.factBottom,
            { borderColor: chrome.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: chrome.textFaint }]}>MEAN AIR</Text>
          <Text style={[styles.cardValue, { color: chrome.temperatureInk }]}>
            {fmtTemp(evaluatedRun.physicalConditions.meanTemperatureC, temperatureUnit)}
          </Text>
          <Text style={[TYPE.support, { color: chrome.textSecondary }]}>over the full run</Text>
        </View>
        <View style={factStyle}>
          <Text style={[styles.cardTitle, { color: chrome.textFaint }]}>SUN EXPOSURE</Text>
          <Text style={[styles.cardValue, { color: chrome.text }]}>
            {routeConditionSummary
              ? (
                  {
                    none: 'None',
                    minimal: 'Minimal',
                    low: 'Low',
                    moderate: 'Moderate',
                    high: 'High',
                  } as const
                )[routeConditionSummary.forecastSunlight.level]
              : runConditions.sunExposure.label}
          </Text>
          <Text style={[TYPE.support, { color: chrome.textSecondary }]}>
            forecast intensity over the full run
          </Text>
        </View>
        <View
          style={[factStyle, !accessibleText && styles.factLeft, { borderColor: chrome.border }]}
        >
          <Text style={[styles.cardTitle, { color: chrome.textFaint }]}>WIND EFFECT</Text>
          <Text style={[styles.cardValue, { color: chrome.text }]}>
            {runConditions.windEffect.headline}
          </Text>
          <Text style={[TYPE.support, { color: chrome.textSecondary }]}>wind resistance</Text>
        </View>
      </Surface>
    );
  }

  return (
    <Surface chrome={chrome} style={styles.factsGrid}>
      {Array.from({ length: 4 }, (_, i) => (
        <View key={i} style={factStyle}>
          <View style={[styles.skeleton, { backgroundColor: chrome.controlBg, width: '60%' }]} />
          <View
            style={[
              styles.skeleton,
              {
                backgroundColor: chrome.controlBg,
                width: '80%',
                height: 22,
                marginTop: 8,
              },
            ]}
          />
        </View>
      ))}
    </Surface>
  );
}

const styles = StyleSheet.create({
  focusRow: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
  },
  focusHeadline: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  focusHeadlineAccessible: { flexWrap: 'wrap' },
  focusDot: { width: 8, height: 8, borderRadius: 4 },
  focusTime: {
    fontFamily: FAMILY.displayMedium,
    fontSize: 14,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  focusAir: {
    ...TYPE.support,
    fontFamily: FAMILY.displayMedium,
    fontVariant: ['tabular-nums'],
  },
  idleStory: { ...TYPE.body },
  focusStory: { minWidth: 0, ...TYPE.support },
  compactSummary: {
    ...TYPE.support,
    minHeight: 18,
    paddingHorizontal: SP[1],
  },
  focusDistance: {
    marginLeft: 'auto',
    ...TYPE.support,
    fontVariant: ['tabular-nums'],
  },
  focusDistanceAccessible: { width: '100%', marginLeft: 0 },
  factsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 0,
    overflow: 'hidden',
  },
  fact: {
    width: '50%',
    minHeight: 116,
    padding: SP[4],
    justifyContent: 'center',
  },
  factAccessible: {
    width: '100%',
    minHeight: 104,
    padding: SP[4],
    justifyContent: 'center',
  },
  factLeft: { borderLeftWidth: StyleSheet.hairlineWidth },
  factBottom: { borderBottomWidth: StyleSheet.hairlineWidth },
  cardTitle: { ...TYPE.label, marginBottom: 2 },
  cardValue: { ...TYPE.data },
  skeleton: { height: 12, borderRadius: 6 },
});
