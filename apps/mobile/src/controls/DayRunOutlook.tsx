import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { calendarDayWindow, fmtClock, type StartCandidateAssessmentV3 } from '@runcast/core';
import type { Planner } from '../state';
import { StartTimeComparison } from '../cards/PrerunBriefing';
import { RADIUS, SP, TYPE } from '../theme';
import {
  accessibilityNudgeStart,
  buildDayRibbonSegments,
  dayOffsetForStart,
  gridStartsForDay,
  nearestGridStart,
  outlookAccessibilityText,
  preferredCandidateForDay,
  presentOutlookCandidate,
  ribbonTone,
  type DayOutlookCandidate,
  type DayRibbonTone,
} from './dayOutlookModel';

const TABS = ['Today', 'Tomorrow'] as const;
const DAY_AXIS_LABELS = ['12a', '6a', '12p', '6p', '12a'] as const;
const RIBBON_HORIZONTAL_PADDING = 2;
const RIBBON_SEGMENT_GAP = 1.5;

function routeTimezone(timezone: string | undefined): string {
  return timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}

function selectedCandidate(planner: Planner): StartCandidateAssessmentV3 | null {
  if (!planner.evaluatedRun) return null;
  return {
    startTime: planner.startTime,
    finishTime: planner.evaluatedRun.finishTime,
    evaluable: true,
    safety: planner.evaluatedRun.safety,
    conditionsFit: planner.evaluatedRun.conditionsFit.value,
    plan: planner.evaluatedRun,
    reasons: planner.evaluatedRun.reasons,
  };
}

function selectionHaptic(): void {
  const feedback =
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Frequent_Tick)
      : Haptics.selectionAsync();
  void feedback.catch(() => {});
}

export function DayRunOutlook({
  planner,
  presentation = 'planner',
}: {
  planner: Planner;
  presentation?: 'planner' | 'sheet';
}) {
  const { fontScale } = useWindowDimensions();
  const stackReadout = fontScale >= 1.3;
  const timezone = routeTimezone(planner.timezone);
  const currentTime = Date.now();
  const today = calendarDayWindow(currentTime, timezone, 0);
  const tomorrow = calendarDayWindow(currentTime, timezone, 1);
  const dayWindows = [today, tomorrow] as const;
  const initialDay = dayOffsetForStart(planner.startTime, today, tomorrow) ?? 0;
  const [viewedDay, setViewedDay] = useState<0 | 1>(initialDay);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(width);
  widthRef.current = width;
  const previewStartRef = useRef<number | null>(null);

  const routeIdentity = `${planner.activeLegacyRoute.id}:${timezone}`;
  useEffect(() => {
    setViewedDay(dayOffsetForStart(planner.startTime, today, tomorrow) ?? 0);
    // A new route gets its own route-local initial tab. Start changes are
    // intentionally excluded because tabs are view-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIdentity]);

  useEffect(() => {
    previewStartRef.current = null;
    return () => planner.previewStartTime(null);
  }, [routeIdentity, planner.previewStartTime]);

  const candidates = planner.startRecommendation?.candidates ?? [];

  const entries = useMemo(() => {
    const byStart = new Map<number, DayOutlookCandidate>();
    for (const candidate of candidates) {
      byStart.set(
        candidate.startTime,
        presentOutlookCandidate(candidate, currentTime, planner.temperatureUnit),
      );
    }
    const selected = selectedCandidate(planner);
    if (selected) {
      byStart.set(
        selected.startTime,
        presentOutlookCandidate(selected, currentTime, planner.temperatureUnit),
      );
    }
    return [...byStart.values()].sort((a, b) => a.startTime - b.startTime);
  }, [currentTime, planner, planner.temperatureUnit, candidates]);

  const viewedWindow = dayWindows[viewedDay];
  const acceptableStartWindow = {
    startMinutes: planner.acceptableStartMinutes,
    endMinutes: planner.acceptableEndMinutes,
    weeklySchedule: planner.weeklyStartSchedule,
    timezone,
  };
  const bestSource = preferredCandidateForDay(candidates, viewedWindow, acceptableStartWindow);
  const bestEntry = bestSource
    ? (entries.find((entry) => entry.startTime === bestSource.startTime) ?? null)
    : null;
  const displayedStart = planner.startTime;
  const selectedDay = dayOffsetForStart(displayedStart, today, tomorrow);
  const selectedEntry = entries.find((entry) => entry.startTime === displayedStart) ?? null;
  const focused = selectedDay === viewedDay ? selectedEntry : bestEntry;

  const segments = useMemo(
    () => buildDayRibbonSegments(viewedWindow, entries, currentTime),
    [currentTime, entries, viewedWindow],
  );
  const gridStarts = useMemo(
    () =>
      gridStartsForDay(
        viewedWindow,
        Math.max(currentTime, planner.sliderWindow.min),
        planner.sliderWindow.max,
      ),
    [currentTime, planner.sliderWindow.max, planner.sliderWindow.min, viewedWindow],
  );

  const startFromX = (x: number): number | null => {
    const trackWidth = widthRef.current;
    if (trackWidth <= 0 || !gridStarts.length) return null;
    const fraction = Math.min(Math.max(x / trackWidth, 0), 1);
    const target = viewedWindow.start + fraction * (viewedWindow.end - viewedWindow.start);
    return nearestGridStart(gridStarts, target);
  };

  const previewFromX = (x: number) => {
    const start = startFromX(x);
    if (start === null || start === previewStartRef.current) return;
    previewStartRef.current = start;
    planner.previewStartTime(start);
    selectionHaptic();
  };

  const commitSelection = (x?: number) => {
    const start = previewStartRef.current ?? (x === undefined ? null : startFromX(x));
    if (start === null) return;
    planner.setStartTime(start);
    previewStartRef.current = null;
  };

  const cancelPreview = () => {
    planner.previewStartTime(null);
    previewStartRef.current = null;
  };

  // Horizontal activation waits for intent; a vertical gesture fails this
  // recognizer and continues through the parent ScrollView.
  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Pan()
          .activeOffsetX([-8, 8])
          .failOffsetY([-14, 14])
          .runOnJS(true)
          .onStart((event) => previewFromX(event.x))
          .onUpdate((event) => previewFromX(event.x))
          .onEnd(() => commitSelection())
          .onFinalize((_event, success) => {
            if (!success) cancelPreview();
          }),
        Gesture.Tap()
          .maxDuration(300)
          .runOnJS(true)
          .onEnd((event, success) => {
            if (!success) return;
            previewFromX(event.x);
            commitSelection(event.x);
          }),
      ),
    // The function intentionally follows the current day/grid every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gridStarts, viewedWindow],
  );

  const nudge = (delta: -1 | 1) => {
    const baseline = focused?.startTime ?? gridStarts[0];
    if (baseline === undefined) return;
    const next = accessibilityNudgeStart(
      baseline,
      delta,
      viewedWindow,
      Math.max(currentTime, planner.sliderWindow.min),
      planner.sliderWindow.max,
    );
    if (next !== null) {
      selectionHaptic();
      planner.setStartTime(next);
    }
  };

  const toneColor = (tone: DayRibbonTone) =>
    tone === 'favorable'
      ? planner.chrome.good
      : tone === 'mixed'
        ? planner.chrome.warn
        : tone === 'challenging'
          ? planner.chrome.danger
          : planner.chrome.border;
  const accessibilityText = outlookAccessibilityText(
    TABS[viewedDay],
    focused,
    focused ? fmtClock(focused.startTime, timezone) : null,
  );

  const selectedSegment =
    selectedDay === viewedDay
      ? segments.findIndex(
          (segment) => displayedStart >= segment.start && displayedStart < segment.end,
        )
      : -1;
  const ribbonReadoutStart = selectedDay === viewedDay ? displayedStart : null;
  const bestSegment = bestEntry
    ? segments.findIndex(
        (segment) => bestEntry.startTime >= segment.start && bestEntry.startTime < segment.end,
      )
    : -1;
  const segmentWidth =
    segments.length > 0
      ? Math.max(
          width - RIBBON_HORIZONTAL_PADDING * 2 - RIBBON_SEGMENT_GAP * (segments.length - 1),
          0,
        ) / segments.length
      : 0;
  const bestMarkerLeft =
    bestSegment >= 0
      ? RIBBON_HORIZONTAL_PADDING +
        bestSegment * (segmentWidth + RIBBON_SEGMENT_GAP) +
        segmentWidth / 2
      : null;
  const bestLegend =
    bestMarkerLeft !== null ? (
      <View style={styles.bestLegend}>
        <View style={[styles.bestLegendRing, { borderColor: planner.chrome.good }]} />
        <Text
          style={[
            TYPE.caption,
            stackReadout && styles.accessibleLineHeight,
            { color: planner.chrome.textSecondary },
          ]}
        >
          {bestEntry ? `Best · ${fmtClock(bestEntry.startTime, timezone)}` : 'Best'}
        </Text>
      </View>
    ) : null;

  return (
    <View style={styles.section}>
      {presentation === 'planner' ? (
        <View style={styles.headingRow}>
          <Text
            style={[
              styles.outlookLabel,
              stackReadout && styles.accessibleLineHeight,
              { color: planner.chrome.textFaint },
            ]}
          >
            DAY OUTLOOK
          </Text>
          {bestLegend}
        </View>
      ) : null}

      <View style={styles.tabs}>
        <View
          pointerEvents="none"
          style={[styles.tabsTrack, { backgroundColor: planner.chrome.controlBg }]}
        />
        {TABS.map((label, index) => {
          const selected = viewedDay === index;
          return (
            <Pressable
              key={label}
              onPress={() => {
                if (viewedDay !== index) selectionHaptic();
                cancelPreview();
                setViewedDay(index as 0 | 1);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.65 }]}
            >
              <View
                style={[
                  styles.tabVisual,
                  selected && {
                    backgroundColor: planner.chrome.surfaceRaised,
                    borderColor: planner.chrome.border,
                  },
                ]}
              >
                <Text
                  style={[
                    TYPE.control,
                    stackReadout && styles.accessibleLineHeight,
                    { color: selected ? planner.chrome.text : planner.chrome.textSecondary },
                  ]}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.ribbonGroup}>
        <View style={styles.startReadoutRow}>
          <Text
            numberOfLines={1}
            style={[
              styles.startReadout,
              stackReadout && styles.accessibleLineHeight,
              {
                color:
                  ribbonReadoutStart === null ? planner.chrome.textSecondary : planner.chrome.text,
              },
            ]}
          >
            {ribbonReadoutStart === null ? (
              'Choose a start'
            ) : (
              <>
                <Text style={{ color: planner.chrome.textSecondary }}>Start</Text>
                {` · ${fmtClock(ribbonReadoutStart, timezone)}`}
              </>
            )}
          </Text>
          {presentation === 'sheet' ? bestLegend : null}
        </View>

        <GestureDetector gesture={gesture}>
          <View
            testID="day-start-chart"
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityText}
            accessibilityValue={{ text: accessibilityText }}
            accessibilityActions={[
              { name: 'decrement', label: 'Earlier start' },
              { name: 'increment', label: 'Later start' },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') nudge(1);
              if (event.nativeEvent.actionName === 'decrement') nudge(-1);
            }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={styles.ribbonTouch}
          >
            <View style={[styles.ribbon, { backgroundColor: planner.chrome.controlBg }]}>
              {segments.map((segment, index) => (
                <View
                  key={segment.start}
                  style={[
                    styles.segment,
                    { backgroundColor: toneColor(ribbonTone(segment.state)) },
                    index === selectedSegment && styles.selectedSegment,
                  ]}
                />
              ))}
            </View>
            {bestMarkerLeft !== null ? (
              <View
                pointerEvents="none"
                style={[
                  styles.bestMarker,
                  {
                    left: bestMarkerLeft,
                    backgroundColor: planner.chrome.surfaceRaised,
                    borderColor: planner.chrome.good,
                  },
                ]}
              />
            ) : null}
          </View>
        </GestureDetector>
      </View>

      <View style={styles.axis}>
        {DAY_AXIS_LABELS.map((label, index) => (
          <Text
            key={`${label}:${index}`}
            accessibilityLabel={index === DAY_AXIS_LABELS.length - 1 ? 'Midnight, next day' : label}
            maxFontSizeMultiplier={1.5}
            style={[styles.axisLabel, { color: planner.chrome.textFaint }]}
          >
            {label}
          </Text>
        ))}
      </View>

      {presentation === 'sheet' ? (
        <View
          style={[styles.sheetPreview, stackReadout && styles.sheetPreviewAccessible]}
          accessibilityLiveRegion="polite"
        >
          {ribbonReadoutStart !== null && focused ? (
            <>
              <Text
                numberOfLines={stackReadout ? 2 : 1}
                adjustsFontSizeToFit={!stackReadout}
                minimumFontScale={0.82}
                style={[
                  styles.sheetPreviewPrimary,
                  stackReadout && styles.accessibleLineHeight,
                  { color: planner.chrome.text },
                ]}
              >
                <Text style={{ color: toneColor(ribbonTone(focused.state)) }}>
                  {focused.condition}
                </Text>
                {` · ${focused.facts}`}
              </Text>
              <Text
                numberOfLines={stackReadout ? 2 : 1}
                style={[
                  styles.sheetPreviewConcern,
                  stackReadout && styles.accessibleLineHeight,
                  { color: planner.chrome.textSecondary },
                ]}
              >
                {focused.concern}
              </Text>
            </>
          ) : (
            <Text
              style={[
                styles.sheetPreviewConcern,
                stackReadout && styles.accessibleLineHeight,
                { color: planner.chrome.textSecondary },
              ]}
            >
              Choose a start to preview route conditions
            </Text>
          )}
        </View>
      ) : null}

      {presentation === 'planner' && planner.startTime !== planner.committedStartTime ? (
        <View
          style={[
            styles.readout,
            stackReadout && styles.readoutStacked,
            { backgroundColor: planner.chrome.surfaceMuted },
          ]}
          accessibilityLiveRegion="polite"
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[
                styles.readoutPrimary,
                stackReadout && styles.accessibleLineHeight,
                { color: planner.chrome.text },
              ]}
            >
              {focused
                ? `${fmtClock(focused.startTime, timezone)} · ${focused.temperature} · ${focused.condition}`
                : `No suitable start available for ${TABS[viewedDay].toLowerCase()}`}
            </Text>
            <Text
              style={[
                TYPE.support,
                stackReadout && styles.accessibleLineHeight,
                { color: planner.chrome.textSecondary },
              ]}
            >
              {focused?.concern ?? 'Forecast conditions are unavailable for this day'}
            </Text>
          </View>
        </View>
      ) : null}
      {selectedDay === viewedDay ? (
        <StartTimeComparison
          planner={planner}
          selectedPlan={
            focused?.startTime === planner.startTime
              ? planner.evaluatedRun
              : (candidates.find((c) => c.startTime === focused?.startTime)?.plan ?? null)
          }
          referencePlan={candidates.find((c) => c.startTime === bestEntry?.startTime)?.plan ?? null}
        />
      ) : (
        <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
          Choose a start to compare conditions.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: SP[2] },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP[2],
  },
  bestLegend: { flexDirection: 'row', alignItems: 'center', gap: SP[1] },
  bestLegendRing: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  tabs: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabsTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 3,
    height: 38,
    borderRadius: RADIUS.md,
  },
  tab: {
    flex: 1,
    height: 44,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabVisual: {
    width: '100%',
    height: 36,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlookLabel: { ...TYPE.label, fontSize: 12, lineHeight: 16, letterSpacing: 0.7 },
  ribbonGroup: { gap: SP[1] },
  startReadoutRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP[2],
  },
  startReadout: { ...TYPE.control, flex: 1, minWidth: 0, fontVariant: ['tabular-nums'] },
  ribbonTouch: { height: 44, justifyContent: 'center' },
  ribbon: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: RIBBON_SEGMENT_GAP,
    borderRadius: RADIUS.md,
    paddingHorizontal: RIBBON_HORIZONTAL_PADDING,
  },
  segment: {
    flex: 1,
    minWidth: 1,
    height: 12,
    borderRadius: 1.5,
    opacity: 0.68,
  },
  selectedSegment: {
    height: 30,
    borderRadius: 3,
    opacity: 1,
    zIndex: 2,
  },
  bestMarker: {
    position: 'absolute',
    top: 3,
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    borderWidth: 2,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -SP[2],
  },
  axisLabel: { ...TYPE.axis, fontSize: 11, lineHeight: 14 },
  sheetPreview: { minHeight: 50, justifyContent: 'center', gap: 2 },
  sheetPreviewAccessible: { minHeight: 72 },
  sheetPreviewPrimary: { ...TYPE.control, fontSize: 15, lineHeight: 19 },
  sheetPreviewConcern: { ...TYPE.support, lineHeight: 18 },
  readout: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    borderRadius: RADIUS.lg,
    padding: SP[3],
  },
  readoutStacked: { flexDirection: 'column', alignItems: 'stretch' },
  readoutPrimary: { ...TYPE.control, marginTop: 2, marginBottom: SP[1] },
  accessibleLineHeight: { lineHeight: undefined },
});
