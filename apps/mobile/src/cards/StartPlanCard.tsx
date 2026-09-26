import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { fmtClock, fmtDay, fmtPace, fmtTemp, presentRunConditions } from '@runcast/core';
import type { Planner } from '../state';
import { PaceStepper } from '../controls/Controls';
import { DayRunOutlook } from '../controls/DayRunOutlook';
import { AppIcon } from '../design/Icon';
import { ActionButton, Surface } from '../design/Primitives';
import { IntroductionTarget } from '../introduction/IntroductionTarget';
import { RADIUS, SP, TYPE } from '../theme';
import { PrerunBriefing } from './PrerunBriefing';
import { finishSummary } from './prerunBriefingModel';
import { AlertBanner } from './AlertBanner';
import { planningSurfaceMode, planningUnavailableMessage } from './startRecommendationPresentation';

interface ConditionFact {
  label: string;
  value: string;
  color: string;
}

function conditionFactLabel(label: string): string {
  return (
    {
      'MEAN AIR': 'air',
      SUN: 'sun',
      WIND: 'wind',
      'FEELS LIKE': 'feels like',
      'DIRECT SUN': 'direct sun',
      RAIN: 'rain',
    }[label] ?? label.toLocaleLowerCase()
  );
}

function ConditionFacts({ facts, planner }: { facts: ConditionFact[]; planner: Planner }) {
  const { fontScale } = useWindowDimensions();
  const stackFacts = fontScale >= 1.3;
  return (
    <Text
      style={[
        styles.factsLine,
        stackFacts && styles.accessibleLineHeight,
        { color: planner.chrome.textSecondary },
      ]}
    >
      {facts.map((fact, index) => (
        <Text key={fact.label}>
          {index > 0 ? ' · ' : ''}
          <Text style={{ color: fact.color }}>
            {fact.label === 'SUN' && fact.value === 'None' ? 'No' : fact.value}
          </Text>{' '}
          {conditionFactLabel(fact.label)}
        </Text>
      ))}
      .
    </Text>
  );
}

function FinishSummary({
  planner,
  finishTime,
  durationSeconds,
  accessibleText,
}: {
  planner: Planner;
  finishTime: number;
  durationSeconds: number;
  accessibleText: boolean;
}) {
  const [timingInfoOpen, setTimingInfoOpen] = useState(false);
  const usesFlatTiming = planner.routeTiming.quality !== 'grade-adjusted';

  return (
    <View style={[styles.finishSummary, accessibleText && styles.finishSummaryAccessible]}>
      <View style={styles.finishLine}>
        <Text
          testID="run-finish-summary"
          style={[
            styles.footerPrimary,
            accessibleText && styles.accessibleLineHeight,
            { color: planner.chrome.text },
          ]}
        >
          {finishSummary(planner.startTime, finishTime, durationSeconds, planner.timezone)}
        </Text>
        {usesFlatTiming ? (
          <Pressable
            hitSlop={8}
            onPress={() => setTimingInfoOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Why flat timing is used"
            accessibilityState={{ expanded: timingInfoOpen }}
            style={({ pressed }) => [styles.timingInfoButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <AppIcon name="info" color={planner.chrome.textFaint} size={16} />
          </Pressable>
        ) : null}
      </View>
      {usesFlatTiming && timingInfoOpen ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.footerSecondary,
            accessibleText && styles.accessibleLineHeight,
            { color: planner.chrome.textFaint },
          ]}
        >
          Flat timing because elevation data is incomplete.
        </Text>
      ) : null}
    </View>
  );
}

/** The Planner's single surface for the selected run, day outlook, and pace. */
export function StartPlanCard({ planner }: { planner: Planner }) {
  const { chrome, evaluatedRun, startTime, timezone, weatherStatus } = planner;
  const [paceOpen, setPaceOpen] = useState(false);
  const { fontScale } = useWindowDimensions();
  const accessibleText = fontScale >= 1.3;
  const compactPace = fmtPace(planner.speed, planner.units).replace(' /', '/');
  const surfaceMode = planningSurfaceMode({
    hasEvaluatedRun: evaluatedRun !== null,
    weatherStatus,
    syncState: planner.planningBundleSyncState,
    environmentExpired: planner.environmentExpired,
  });

  if (surfaceMode === 'loading' || surfaceMode === 'unavailable') {
    const unavailableMessage = planningUnavailableMessage({
      weatherStatus,
      syncState: planner.planningBundleSyncState,
      environmentExpired: planner.environmentExpired,
      reasons: planner.planningUnavailableReasons,
    });
    return (
      <Surface chrome={chrome} style={styles.card}>
        {surfaceMode === 'unavailable' ? (
          <>
            <Text style={[styles.day, { color: chrome.textSecondary }]}>
              {fmtDay(startTime, timezone)}
            </Text>
            <Text style={[styles.time, { color: chrome.text }]}>
              {fmtClock(startTime, timezone)}
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[TYPE.body, { color: chrome.textSecondary }]}
            >
              {unavailableMessage}
            </Text>
            <IntroductionTarget id="day-outlook">
              <DayRunOutlook planner={planner} />
            </IntroductionTarget>
            {weatherStatus === 'error' && planner.planningBundleSyncState === null ? (
              <View style={{ alignItems: 'flex-start' }}>
                <ActionButton
                  label="Retry forecast"
                  chrome={chrome}
                  onPress={planner.retryWeather}
                />
              </View>
            ) : null}
            <View style={[styles.footer, { borderColor: chrome.border }]}>
              <FinishSummary
                planner={planner}
                finishTime={planner.routeTiming.finishTime}
                durationSeconds={planner.routeTiming.durationSeconds}
                accessibleText={accessibleText}
              />
            </View>
          </>
        ) : (
          <View style={styles.loadingRow} accessibilityLiveRegion="polite">
            <ActivityIndicator color={chrome.accentInk} />
            <Text style={[TYPE.support, { color: chrome.textSecondary }]}>
              Building your run plan…
            </Text>
          </View>
        )}
      </Surface>
    );
  }

  const runConditions = evaluatedRun ? presentRunConditions(evaluatedRun) : null;
  const dominantConditionsFactor = runConditions?.factors.reduce((highest, factor) =>
    factor.penaltyPoints > highest.penaltyPoints ? factor : highest,
  );
  const conditionsBadgeDetail = runConditions
    ? runConditions.dominantFactorStory === 'No major forecast tradeoffs'
      ? 'Balanced'
      : dominantConditionsFactor?.label === 'Sun and warmth'
        ? 'Sun + warmth'
        : dominantConditionsFactor?.label === 'Wind resistance'
          ? 'Wind'
          : (dominantConditionsFactor?.label ?? 'Conditions')
    : 'Conditions';
  const durationSeconds = evaluatedRun?.durationSeconds ?? planner.routeTiming.durationSeconds;
  const endTime = evaluatedRun?.finishTime ?? startTime + durationSeconds * 1000;
  const facts: ConditionFact[] =
    evaluatedRun && runConditions
      ? [
          {
            label: 'MEAN AIR',
            value: fmtTemp(
              evaluatedRun.physicalConditions.meanTemperatureC,
              planner.temperatureUnit,
            ),
            color: chrome.temperatureInk,
          },
          { label: 'SUN', value: runConditions.sunExposure.label, color: chrome.sunInk },
          { label: 'WIND', value: runConditions.windEffect.headline, color: chrome.windInk },
        ]
      : [];

  return (
    <Surface chrome={chrome} style={styles.card}>
      <View style={[styles.choiceHeader, accessibleText && styles.choiceHeaderAccessible]}>
        <View style={[{ flex: 1, minWidth: 0 }, accessibleText && { flex: 0 }]}>
          <Text style={[styles.selectedLabel, { color: chrome.textFaint }]}>SELECTED RUN</Text>
          <Text style={[styles.day, { color: chrome.textSecondary }]}>
            {fmtDay(startTime, timezone)} · starts
          </Text>
          <Text style={[styles.time, { color: chrome.text }]}>{fmtClock(startTime, timezone)}</Text>
        </View>
        <View
          style={[
            styles.conditionsBadge,
            accessibleText && styles.conditionsBadgeAccessible,
            { backgroundColor: chrome.surfaceMuted },
          ]}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[styles.conditionsValue, { color: chrome.text }]}
          >
            {runConditions?.overallLabel ?? '—'}
          </Text>
          <Text numberOfLines={1} style={[styles.conditionsLabel, { color: chrome.textSecondary }]}>
            {conditionsBadgeDetail}
          </Text>
        </View>
      </View>

      <View style={styles.conditionsSummary}>
        <PrerunBriefing planner={planner} />
        {facts.length ? <ConditionFacts facts={facts} planner={planner} /> : null}
        <AlertBanner planner={planner} variant="rail" />
      </View>

      <View style={[styles.divider, { backgroundColor: chrome.border }]} />
      <IntroductionTarget id="day-outlook">
        <DayRunOutlook planner={planner} />
      </IntroductionTarget>

      <View
        style={[
          styles.footer,
          accessibleText && styles.footerAccessible,
          { borderColor: chrome.border },
        ]}
      >
        <FinishSummary
          planner={planner}
          finishTime={endTime}
          durationSeconds={durationSeconds}
          accessibleText={accessibleText}
        />
        <Pressable
          onPress={() => setPaceOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`Pace ${compactPace}, edit pace`}
          accessibilityState={{ expanded: paceOpen }}
          style={({ pressed }) => [
            styles.paceButton,
            accessibleText && styles.paceButtonAccessible,
            pressed && { opacity: 0.65 },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.paceText,
              accessibleText && styles.accessibleLineHeight,
              { color: chrome.text },
            ]}
          >
            <Text style={{ color: chrome.textSecondary }}>Pace </Text>
            {compactPace}
          </Text>
          <AppIcon
            name={paceOpen ? 'chevron-down' : 'chevron-right'}
            color={chrome.accentInk}
            size={16}
          />
        </Pressable>
      </View>

      {paceOpen ? (
        <View style={[styles.paceEditor, { borderColor: chrome.border }]}>
          <PaceStepper planner={planner} showHeading={false} />
        </View>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { gap: SP[4] },
  choiceHeader: { flexDirection: 'row', alignItems: 'center', gap: SP[4] },
  choiceHeaderAccessible: { flexDirection: 'column', alignItems: 'stretch' },
  selectedLabel: TYPE.label,
  day: { ...TYPE.support, marginTop: SP[1] },
  time: TYPE.hero,
  conditionsBadge: {
    width: 100,
    minHeight: 52,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP[2],
    paddingVertical: SP[1],
  },
  conditionsBadgeAccessible: { width: '100%', minHeight: 48 },
  comfortValue: { ...TYPE.control, fontSize: 15, lineHeight: 19 },
  conditionsValue: { ...TYPE.control, fontSize: 15, lineHeight: 19 },
  conditionsLabel: { ...TYPE.label, letterSpacing: 0, textAlign: 'center' },
  conditionsSummary: { gap: SP[2] },
  factsLine: {
    ...TYPE.title,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  accessibleLineHeight: { lineHeight: undefined },
  divider: { height: StyleSheet.hairlineWidth },
  footer: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SP[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  footerAccessible: { flexDirection: 'column', alignItems: 'stretch' },
  finishSummary: { flex: 1, minWidth: 0 },
  finishSummaryAccessible: { flex: 0 },
  finishLine: { flexDirection: 'row', alignItems: 'center', gap: SP[1] },
  footerPrimary: { ...TYPE.control, flexShrink: 1, fontVariant: ['tabular-nums'] },
  footerSecondary: { ...TYPE.caption, marginTop: 2 },
  timingInfoButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paceButton: {
    minHeight: 44,
    paddingLeft: SP[1],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SP[1],
  },
  paceButtonAccessible: {
    alignSelf: 'stretch',
    minHeight: 0,
    paddingVertical: SP[3],
    justifyContent: 'space-between',
  },
  paceText: { ...TYPE.control, fontVariant: ['tabular-nums'] },
  paceEditor: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SP[3] },
  loadingRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: SP[3] },
});
