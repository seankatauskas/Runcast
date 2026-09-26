/**
 * Grade-adjusted splits, collapsed by default. Each row is one mile/km:
 * expected flat pace (slower uphill — the Minetti adjustment made visible),
 * arrival clock time, feels-like, and the dominant exposure + wind.
 * Tapping a row publishes the split's midpoint through the hover bus, so
 * the map dot, strip cursor, and focus row all jump there — the same
 * channel map taps and the flyover already use.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  buildRouteConditionSplits,
  fmtClock,
  fmtTemp,
  fmtWindSpeed,
  hoverBus,
  M_PER_MI,
  speedToPaceSeconds,
  type RouteConditionSplit,
} from '@runcast/core';
import type { Planner } from '../state';
import { AppIcon } from '../design/Icon';
import { RADIUS, SP, TYPE } from '../theme';

/** "m:ss" without the "/mi" suffix — the unit is the row itself. */
function paceStr(speed: number, units: 'metric' | 'imperial'): string {
  if (speed <= 0) return '–';
  const sec = Math.round(speedToPaceSeconds(speed, units));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function Splits({ planner }: { planner: Planner }) {
  const { chrome, routeConditionsProfile, units, temperatureUnit, timezone } = planner;
  const [open, setOpen] = useState(false);

  const conditionSplits = useMemo(
    () =>
      routeConditionsProfile
        ? buildRouteConditionSplits(routeConditionsProfile, units === 'metric' ? 1000 : M_PER_MI)
        : [],
    [routeConditionsProfile, units],
  );
  if (conditionSplits.length === 0) return null;
  const unitM = units === 'metric' ? 1000 : M_PER_MI;
  const rowLabel = (split: RouteConditionSplit) => {
    const lengthM = split.endDistanceM - split.startDistanceM;
    return lengthM < unitM - 1 ? (lengthM / unitM).toFixed(2) : String(split.index);
  };
  const windLabel = (split: RouteConditionSplit) => {
    if (split.windClass === 'calm') return 'calm';
    if (split.windClass === 'headwind') {
      return `head ${fmtWindSpeed(Math.max(split.meanHeadwindMs, 0), units)}`;
    }
    if (split.windClass === 'tailwind') {
      return `tail ${fmtWindSpeed(Math.max(-split.meanHeadwindMs, 0), units)}`;
    }
    return `cross ${split.crosswindSide ?? ''} ${fmtWindSpeed(Math.abs(split.meanCrosswindMs), units)}`.replace(
      '  ',
      ' ',
    );
  };
  const sunlightLabel = (split: RouteConditionSplit) =>
    split.forecastSunlightLevel === 'none'
      ? 'no forecast sun'
      : `${split.forecastSunlightLevel} forecast sun`;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: chrome.surfaceRaised, borderColor: chrome.border },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel="Professional route splits"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.title, { color: chrome.textFaint }]}>
          PRO SPLITS · {conditionSplits.length}
        </Text>
        <AppIcon
          name={open ? 'chevron-down' : 'chevron-right'}
          color={chrome.textFaint}
          size={16}
        />
      </Pressable>

      {open ? (
        <View style={{ paddingBottom: SP[2] }}>
          {conditionSplits.map((split) => {
            const accessibilityLabel = `${units === 'metric' ? 'Kilometer' : 'Mile'} ${rowLabel(split)}, pace ${paceStr(split.speedMs, units)}, arrive ${fmtClock(split.endTime, timezone)}, ${sunlightLabel(split)}, ${windLabel(split)}, gusts ${fmtWindSpeed(split.peakGustMs, units)}`;
            return (
              <Pressable
                key={split.index}
                style={({ pressed }) => [
                  styles.proRow,
                  { borderColor: chrome.border },
                  pressed && { backgroundColor: chrome.controlBg },
                ]}
                onPress={() =>
                  hoverBus.publish({
                    distance: (split.startDistanceM + split.endDistanceM) / 2,
                    source: 'splits',
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
              >
                <View style={styles.proPrimaryRow}>
                  <Text
                    style={[styles.proIndex, { color: chrome.text }]}
                    children={`${units === 'metric' ? 'KM' : 'MI'} ${rowLabel(split)}`}
                  />
                  <Text
                    style={[styles.proPace, { color: chrome.text }]}
                    children={paceStr(split.speedMs, units)}
                  />
                  <Text
                    style={[styles.proClock, { color: chrome.textSecondary }]}
                    children={fmtClock(split.endTime, timezone)}
                  />
                  <Text
                    style={[styles.proTemp, { color: chrome.temperatureInk }]}
                    children={fmtTemp(split.meanFeelsLikeC, temperatureUnit)}
                  />
                </View>
                <Text
                  numberOfLines={2}
                  style={[styles.proConditions, { color: chrome.textSecondary }]}
                >
                  {sunlightLabel(split)} · {windLabel(split)} · gusts{' '}
                  {fmtWindSpeed(split.peakGustMs, units)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SP[4],
    paddingVertical: SP[3],
  },
  title: { ...TYPE.label },
  proRow: {
    paddingHorizontal: SP[4],
    paddingVertical: SP[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: SP[1],
  },
  proPrimaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: SP[2] },
  proIndex: { ...TYPE.label, width: 50 },
  proPace: { ...TYPE.support, width: 48, fontVariant: ['tabular-nums'] },
  proClock: { ...TYPE.support, flex: 1, minWidth: 72, fontVariant: ['tabular-nums'] },
  proTemp: {
    ...TYPE.support,
    width: 44,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  proConditions: { ...TYPE.support, textTransform: 'lowercase' },
});
