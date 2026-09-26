import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { calendarDayWindow, fmtClock, fmtDay, fmtPace, fmtTemp, fmtWindSpeed } from '@runcast/core';
import type { Planner } from '../state';
import { AppIcon } from '../design/Icon';
import { ActionButton } from '../design/Primitives';
import { IntroductionTarget } from '../introduction/IntroductionTarget';
import { FAMILY, RADIUS, SP, TYPE } from '../theme';
import { PrerunBriefing, StartTimeComparison } from './PrerunBriefing';
import { finishSummary, recommendationForStartDay } from './prerunBriefingModel';
import {
  planningUnavailableMessage,
  startRecommendationPresentation,
} from './startRecommendationPresentation';
import {
  buildStartWindowBars,
  runBriefPrimaryLabel,
  startWindowBarAtX,
  type StartRecommendationSlice,
} from './runBriefModel';

interface Props {
  planner: Planner;
  routeMeta: string;
  maxContentHeight: number;
  accessibleText: boolean;
  contentOpacity: Animated.Value;
  onEditStart: () => void;
  onEditPace: () => void;
  onOpenPlan: (startTime: number) => void;
}

function WindowCurve({
  planner,
  recommendation,
  winnerStart,
  selectedStart,
  dayLabel,
  onPreviewStart,
  onCommitStart,
  onCancelPreview,
}: {
  planner: Planner;
  recommendation: StartRecommendationSlice | null;
  winnerStart: number | null;
  selectedStart: number | null;
  dayLabel: string;
  onPreviewStart: (startTime: number) => void;
  onCommitStart: (startTime: number) => void;
  onCancelPreview: () => void;
}) {
  const interactionBars = useMemo(
    () => buildStartWindowBars(recommendation?.candidates ?? [], null, winnerStart),
    [recommendation?.candidates, winnerStart],
  );
  const bars = useMemo(
    () => buildStartWindowBars(recommendation?.candidates ?? [], selectedStart, winnerStart),
    [recommendation?.candidates, selectedStart, winnerStart],
  );
  const widthRef = useRef(0);
  const scrubbedStartRef = useRef<number | null>(null);
  const previewFromX = useCallback(
    (x: number) => {
      const bar = startWindowBarAtX(interactionBars, x, widthRef.current);
      if (!bar || bar.startTime === scrubbedStartRef.current) return;
      scrubbedStartRef.current = bar.startTime;
      onPreviewStart(bar.startTime);
      void Haptics.selectionAsync().catch(() => {});
    },
    [interactionBars, onPreviewStart],
  );
  const commitFromX = useCallback(
    (x?: number) => {
      const startTime =
        scrubbedStartRef.current ??
        (x === undefined
          ? null
          : (startWindowBarAtX(interactionBars, x, widthRef.current)?.startTime ?? null));
      scrubbedStartRef.current = null;
      if (startTime !== null) onCommitStart(startTime);
    },
    [interactionBars, onCommitStart],
  );
  const cancelPreview = useCallback(() => {
    scrubbedStartRef.current = null;
    onCancelPreview();
  }, [onCancelPreview]);
  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Pan()
          .activeOffsetX([-4, 4])
          .failOffsetY([-12, 12])
          .runOnJS(true)
          .onStart((event) => previewFromX(event.x))
          .onUpdate((event) => previewFromX(event.x))
          .onEnd(() => commitFromX())
          .onFinalize((_event, success) => {
            if (!success) cancelPreview();
          }),
        Gesture.Tap()
          .maxDuration(300)
          .runOnJS(true)
          .onEnd((event, success) => {
            if (!success) return;
            previewFromX(event.x);
            commitFromX(event.x);
          }),
      ),
    [cancelPreview, commitFromX, previewFromX],
  );

  if (bars.length === 0) {
    const pending =
      planner.weatherStatus === 'loading' || planner.selected.planningSyncState === 'preparing';
    return (
      <View style={styles.curveEmpty}>
        {pending ? (
          <ActivityIndicator
            accessibilityLabel="Comparing start times"
            color={planner.chrome.cockpitAccent}
            size="small"
          />
        ) : (
          <Text style={{ color: planner.chrome.textSecondary }}>
            No start-time recommendation available.
          </Text>
        )}
      </View>
    );
  }

  const recommendedBar = bars.find((bar) => bar.recommended) ?? null;
  const recommendedLabel =
    recommendedBar === null ? null : fmtClock(recommendedBar.startTime, planner.timezone);
  const selectedBar = bars.find((bar) => bar.selected) ?? null;
  const selectedLabel =
    selectedBar === null ? null : fmtClock(selectedBar.startTime, planner.timezone);
  const selectedBarIndex = bars.findIndex((bar) => bar.selected);
  const recommendedBarIndex = bars.findIndex((bar) => bar.recommended);
  const activeBarIndex =
    selectedBarIndex >= 0 ? selectedBarIndex : Math.max(recommendedBarIndex, 0);
  const adjustSelection = (delta: -1 | 1) => {
    const bar = bars[Math.min(Math.max(activeBarIndex + delta, 0), bars.length - 1)];
    if (!bar) return;
    void Haptics.selectionAsync().catch(() => {});
    onPreviewStart(bar.startTime);
    onCommitStart(bar.startTime);
  };
  const accessibilityLabel = `Start-time conditions ${dayLabel}. ${
    selectedLabel === null
      ? recommendedLabel === null
        ? `No recommended start ${dayLabel}.`
        : `Best Start ${recommendedLabel}.`
      : `Selected time ${selectedLabel}; Best Start ${recommendedLabel ?? 'unavailable'}.`
  } Swipe up or down to change the start.`;

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="explorer-start-chart"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: selectedLabel ?? recommendedLabel ?? 'Unavailable' }}
        accessibilityActions={[
          { name: 'decrement', label: 'Earlier start' },
          { name: 'increment', label: 'Later start' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'decrement') adjustSelection(-1);
          if (event.nativeEvent.actionName === 'increment') adjustSelection(1);
        }}
        onLayout={(event) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        style={styles.curve}
      >
        <View style={styles.curveBars}>
          {bars.map((bar, index) => {
            return (
              <View key={`${bar.startTime}:${index}`} style={styles.curveBarSlot}>
                <View
                  style={[
                    styles.curveBar,
                    {
                      height: 10 + bar.quality * 46,
                      opacity:
                        bar.selected || bar.recommended
                          ? 1
                          : bar.evaluable
                            ? 0.28 + bar.quality * 0.36
                            : 0.18,
                      backgroundColor: bar.selected
                        ? planner.chrome.cockpitText
                        : bar.recommended
                          ? planner.chrome.cockpitAccent
                          : !bar.evaluable
                            ? planner.chrome.danger
                            : planner.chrome.cockpitText,
                    },
                  ]}
                />
                {bar.recommended ? (
                  <View
                    style={[
                      styles.recommendedMarker,
                      {
                        backgroundColor: planner.chrome.cockpitAccent,
                        borderColor: planner.chrome.cockpit,
                      },
                    ]}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </GestureDetector>
  );
}

function Metric({
  label,
  value,
  accent,
  planner,
}: {
  label: string;
  value: string;
  accent: string;
  planner: Planner;
}) {
  return (
    <View style={styles.metric}>
      <View style={[styles.metricRule, { backgroundColor: accent }]} />
      <Text style={[styles.metricLabel, { color: planner.chrome.cockpitTextSecondary }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.76}
        style={[styles.metricValue, { color: planner.chrome.cockpitText }]}
      >
        {value}
      </Text>
    </View>
  );
}

function UtilityAction({
  label,
  value,
  accessibilityLabel,
  onPress,
  planner,
  testID,
  allowWrap = false,
}: {
  label: string;
  value: string;
  accessibilityLabel: string;
  onPress: () => void;
  planner: Planner;
  testID?: string;
  allowWrap?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [
        styles.quietAction,
        {
          backgroundColor: planner.chrome.cockpitRaised,
          borderColor: planner.chrome.cockpitBorder,
          opacity: pressed ? 0.68 : 1,
        },
      ]}
    >
      <Text style={[styles.utilityLabel, { color: planner.chrome.cockpitTextSecondary }]}>
        {label}
      </Text>
      <View style={styles.utilityValueRow}>
        <Text
          numberOfLines={allowWrap ? undefined : 1}
          adjustsFontSizeToFit={!allowWrap}
          minimumFontScale={0.84}
          style={[styles.utilityValue, { color: planner.chrome.cockpitText }]}
        >
          {value}
        </Text>
        <AppIcon
          name="chevron-down"
          color={planner.chrome.cockpitAccent}
          size={10}
          backgroundColor={planner.chrome.cockpitRaised}
        />
      </View>
    </Pressable>
  );
}

export function RunBriefDock({
  planner,
  routeMeta,
  maxContentHeight,
  accessibleText,
  contentOpacity,
  onEditStart,
  onEditPace,
  onOpenPlan,
}: Props) {
  const [actionHeight, setActionHeight] = useState(52);
  const timezone = planner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const displayedDay = calendarDayWindow(planner.startTime, timezone, 0).start;
  const displayedRecommendation = useMemo(
    () =>
      recommendationForStartDay(planner.startRecommendation, displayedDay, {
        startMinutes: planner.acceptableStartMinutes,
        endMinutes: planner.acceptableEndMinutes,
        weeklySchedule: planner.weeklyStartSchedule,
        timezone,
      }),
    [
      planner.startRecommendation,
      displayedDay,
      planner.acceptableStartMinutes,
      planner.acceptableEndMinutes,
      planner.weeklyStartSchedule,
      timezone,
    ],
  );
  const presentation = startRecommendationPresentation({
    recommendation: displayedRecommendation,
    unavailableReasons: planner.startRecommendationUnavailableReasons,
    syncState: planner.planningBundleSyncState,
    environmentExpired: planner.environmentExpired,
  });
  const winnerStart = presentation.winnerStartTime;
  const displayStart = planner.startTime;
  const isRecommended = winnerStart !== null && displayStart === winnerStart;
  const isSelected =
    !isRecommended &&
    (planner.startSelectionMode === 'selected' || planner.startTime !== planner.committedStartTime);
  const recommendationDayLabel =
    displayStart >= calendarDayWindow(planner.sliderWindow.min, timezone, 1).end
      ? fmtDay(displayStart, timezone)
      : calendarDayWindow(planner.sliderWindow.min, timezone, 0).end <= displayStart
        ? 'tomorrow'
        : 'today';
  const hasStart = isSelected || winnerStart !== null || planner.displayContext.plan !== null;
  const primaryLabel = hasStart ? runBriefPrimaryLabel() : 'Choose a start time';
  const unavailableMessage = planningUnavailableMessage({
    weatherStatus: planner.weatherStatus,
    syncState: planner.planningBundleSyncState,
    environmentExpired: planner.environmentExpired,
    reasons: planner.planningUnavailableReasons,
  });
  const plan = planner.displayContext.plan;
  const metrics = plan
    ? {
        feels: fmtTemp(plan.physicalConditions.peaks.feelsLikeC, planner.temperatureUnit),
        rain: `${Math.round(plan.physicalConditions.peaks.precipitationProbabilityPct)}%`,
        gusts: fmtWindSpeed(plan.physicalConditions.peaks.gustMs, planner.units),
      }
    : null;
  const finish = planner.displayContext.timing;
  const actionChrome: Planner['chrome'] = {
    ...planner.chrome,
    controlActive: planner.chrome.cockpitAccent,
    controlActiveText: planner.chrome.cockpitAccentText,
  };

  const handleCurvePreview = planner.previewStartTime;
  const handleCurveCancel = useCallback(
    () => planner.previewStartTime(null),
    [planner.previewStartTime],
  );
  const handleCurveCommit = planner.setStartTime;

  function handlePrimary() {
    if (!hasStart) {
      onEditStart();
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onOpenPlan(planner.committedStartTime);
  }

  return (
    <>
      <ScrollView
        style={{ height: Math.max(100, maxContentHeight - actionHeight), flexShrink: 1 }}
        contentContainerStyle={{ gap: SP[3] }}
        showsVerticalScrollIndicator
        bounces={false}
      >
        <View>
          <View style={[styles.heroRow, accessibleText && styles.heroRowAccessible]}>
            <View style={styles.decision}>
              <View style={styles.eyebrowRow}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: isSelected
                        ? planner.chrome.cockpitText
                        : presentation.status === 'caution'
                          ? planner.chrome.warn
                          : presentation.status === 'no-suitable-window'
                            ? planner.chrome.danger
                            : planner.chrome.cockpitAccent,
                    },
                  ]}
                />
                <Text style={[styles.eyebrow, { color: planner.chrome.cockpitTextSecondary }]}>
                  {isSelected
                    ? 'SELECTED TIME'
                    : presentation.status === 'recommended'
                      ? `BEST TIME ${recommendationDayLabel.toUpperCase()}`
                      : presentation.label}
                </Text>
              </View>
              <Text
                style={[styles.recommendedTime, { color: planner.chrome.cockpitText }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
              >
                {fmtClock(displayStart, planner.timezone)}
              </Text>
              <Text style={[styles.dateLine, { color: planner.chrome.cockpitTextSecondary }]}>
                {fmtDay(displayStart, planner.timezone)} · {routeMeta}
              </Text>
              <Text
                testID="active-route-name"
                style={[styles.routeName, { color: planner.chrome.cockpitText }]}
              >
                {planner.activeLegacyRoute.name}
              </Text>
            </View>
            <WindowCurve
              planner={planner}
              recommendation={displayedRecommendation}
              winnerStart={winnerStart}
              selectedStart={isSelected ? displayStart : null}
              dayLabel={recommendationDayLabel}
              onPreviewStart={handleCurvePreview}
              onCommitStart={handleCurveCommit}
              onCancelPreview={handleCurveCancel}
            />
          </View>
          <Text
            testID="run-finish-summary"
            numberOfLines={accessibleText ? undefined : 1}
            adjustsFontSizeToFit={!accessibleText}
            minimumFontScale={0.85}
            style={[styles.dateLine, { color: planner.chrome.cockpitTextSecondary }]}
          >
            {finishSummary(displayStart, finish.finishTime, finish.durationSeconds, timezone)}
          </Text>
          <StartTimeComparison planner={planner} overlay />
        </View>
        <Animated.View style={{ opacity: contentOpacity }}>
          {metrics ? (
            <IntroductionTarget
              id="along-route"
              testID="forecast-ready"
              style={[
                styles.conditionDeck,
                { backgroundColor: planner.chrome.cockpitRaised },
                accessibleText && styles.conditionDeckAccessible,
              ]}
            >
              <PrerunBriefing planner={planner} overlay />
              <View style={[styles.metricRow, accessibleText && styles.metricRowAccessible]}>
                <Metric
                  label="Peak feels like"
                  value={metrics.feels}
                  accent={planner.chrome.temperature}
                  planner={planner}
                />
                <View
                  style={[styles.metricDivider, { backgroundColor: planner.chrome.cockpitBorder }]}
                />
                <Metric
                  label="Peak rain chance"
                  value={metrics.rain}
                  accent={planner.chrome.rain}
                  planner={planner}
                />
                <View
                  style={[styles.metricDivider, { backgroundColor: planner.chrome.cockpitBorder }]}
                />
                <Metric
                  label="Peak gusts"
                  value={metrics.gusts}
                  accent={planner.chrome.wind}
                  planner={planner}
                />
              </View>
            </IntroductionTarget>
          ) : isSelected &&
            planner.weatherStatus !== 'loading' &&
            planner.weatherStatus !== 'error' ? (
            <View style={styles.statusState} accessibilityLiveRegion="polite">
              <Text style={[styles.statusCopy, { color: planner.chrome.cockpitTextSecondary }]}>
                Forecast unavailable for this start.
              </Text>
            </View>
          ) : planner.weatherStatus === 'error' && !planner.evaluatedRun ? (
            <View testID="forecast-error" style={styles.statusState}>
              <Text
                style={[
                  TYPE.support,
                  styles.statusCopy,
                  { color: planner.chrome.cockpitTextSecondary },
                ]}
              >
                {unavailableMessage}
              </Text>
              <ActionButton
                label="Retry"
                chrome={actionChrome}
                onPress={planner.retryWeather}
                testID="forecast-retry"
              />
            </View>
          ) : (
            <View style={styles.statusState} accessibilityLiveRegion="polite">
              {planner.weatherStatus === 'loading' ||
              planner.selected.planningSyncState === 'preparing' ? (
                <ActivityIndicator color={planner.chrome.cockpitAccent} size="small" />
              ) : null}
              <Text
                style={[
                  TYPE.support,
                  styles.statusCopy,
                  { color: planner.chrome.cockpitTextSecondary },
                ]}
              >
                {planner.weatherStatus === 'loading'
                  ? 'Building an along-route forecast…'
                  : unavailableMessage}
              </Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
      <View
        onLayout={(event) => setActionHeight(event.nativeEvent.layout.height)}
        style={[styles.actionRow, accessibleText && styles.actionRowAccessible]}
      >
        <IntroductionTarget id="start-time" style={styles.startActionTarget}>
          <UtilityAction
            allowWrap={accessibleText}
            label="START"
            value="Change time"
            accessibilityLabel="Choose a different run start time"
            onPress={onEditStart}
            planner={planner}
            testID="choose-another-start-time"
          />
        </IntroductionTarget>
        <IntroductionTarget id="pace" style={styles.paceActionTarget}>
          <UtilityAction
            allowWrap={accessibleText}
            label="PACE"
            value={fmtPace(planner.speed, planner.units).replace(' ', '')}
            accessibilityLabel={`Edit expected flat pace, ${fmtPace(planner.speed, planner.units)}`}
            onPress={onEditPace}
            planner={planner}
          />
        </IntroductionTarget>
        <IntroductionTarget
          id="full-plan"
          style={[
            styles.primaryTarget,
            accessibleText && { flex: 0, width: '100%', minWidth: '100%' },
          ]}
        >
          <ActionButton
            label={primaryLabel}
            chrome={actionChrome}
            onPress={handlePrimary}
            trailingIcon="chevron-right"
            testID="open-best-run-plan"
            compact
            wrapLabel
          />
        </IntroductionTarget>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  heroRow: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: SP[3],
  },
  heroRowAccessible: { minHeight: 196, flexDirection: 'column', gap: SP[2] },
  decision: { flex: 1, minWidth: 0, justifyContent: 'center' },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[1],
    marginBottom: -1,
  },
  statusDot: { width: 7, height: 7, borderRadius: RADIUS.full },
  eyebrow: { ...TYPE.label, flexShrink: 1 },
  recommendedTime: {
    fontFamily: FAMILY.display,
    fontSize: 36,
    lineHeight: 41,
    letterSpacing: -0.9,
    fontVariant: ['tabular-nums'],
  },
  dateLine: { ...TYPE.caption, fontVariant: ['tabular-nums'] },
  routeName: { ...TYPE.support, fontWeight: '600', marginTop: 1 },
  curve: {
    width: 148,
    minHeight: 104,
    paddingTop: 8,
    paddingBottom: 8,
    justifyContent: 'center',
  },
  curveBars: {
    height: 76,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 2,
  },
  curveBarSlot: {
    flex: 1,
    height: 70,
    minWidth: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  curveBar: {
    width: '100%',
    maxWidth: 10,
    minWidth: 3,
    borderRadius: RADIUS.full,
    borderWidth: 0,
  },
  recommendedMarker: {
    position: 'absolute',
    bottom: -14,
    width: 7,
    height: 7,
    borderRadius: RADIUS.full,
    borderWidth: 2,
  },
  curveEmpty: {
    width: 148,
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conditionDeck: {
    minHeight: 82,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SP[3],
    paddingVertical: SP[2],
    gap: SP[2],
  },
  conditionDeckAccessible: { minHeight: 126 },
  metricRow: { flexDirection: 'row', alignItems: 'stretch' },
  metricRowAccessible: { flexDirection: 'column', gap: SP[2] },
  metric: { flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: SP[2] },
  metricRule: { width: 14, height: 2, borderRadius: RADIUS.full, marginBottom: 2 },
  metricLabel: TYPE.axis,
  metricValue: {
    fontFamily: FAMILY.displayMedium,
    fontSize: 18,
    lineHeight: 23,
    fontVariant: ['tabular-nums'],
  },
  metricDivider: { width: StyleSheet.hairlineWidth },
  statusState: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    paddingHorizontal: SP[3],
  },
  statusCopy: { flex: 1 },
  actionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  actionRowAccessible: { width: '100%', flexWrap: 'wrap', alignItems: 'stretch' },
  startActionTarget: { flex: 1.1, minWidth: 0 },
  paceActionTarget: { flex: 0.9, minWidth: 0 },
  primaryTarget: { flex: 1.5, minWidth: 0 },
  quietAction: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    borderCurve: 'continuous',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: SP[2],
  },
  utilityLabel: { ...TYPE.axis, fontSize: 9, lineHeight: 11 },
  utilityValueRow: { flexDirection: 'row', alignItems: 'center', gap: SP[1], minWidth: 0 },
  utilityValue: {
    ...TYPE.support,
    minWidth: 0,
    flexShrink: 1,
    fontWeight: '600',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
