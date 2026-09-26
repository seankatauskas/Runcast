import { Text, View, useWindowDimensions } from 'react-native';
import { isOutAndBack, type EvaluatedRunV3 } from '@runcast/core';
import type { Planner } from '../state';
import { SP, TYPE } from '../theme';
import { prerunObservations } from './alongRouteModel';
import {
  compareRunStarts,
  explorerComparisonSummary,
  recommendationForStartDay,
} from './prerunBriefingModel';

export function PrerunBriefing({
  planner,
  overlay = false,
}: {
  planner: Planner;
  overlay?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const { profile, alerts } = planner.displayContext;
  if (!profile) return null;
  const observations = prerunObservations(
    profile,
    alerts,
    planner.units,
    isOutAndBack(planner.activeLegacyRoute),
  );
  if (overlay) {
    return (
      <Text
        testID="prerun-briefing"
        style={[
          TYPE.support,
          { color: planner.chrome.cockpitText, minHeight: TYPE.support.lineHeight * fontScale * 2 },
        ]}
      >
        {observations.filter((copy) => copy !== 'Conditions stay fairly steady').join(' · ')}
      </Text>
    );
  }
  return (
    <View testID="prerun-briefing" style={{ gap: SP[1] }}>
      <Text
        style={[
          TYPE.label,
          { color: overlay ? planner.chrome.cockpitTextSecondary : planner.chrome.textFaint },
        ]}
      >
        Along your run
      </Text>
      {observations.map((copy, index) => (
        <Text
          key={index}
          style={[
            TYPE.support,
            { color: overlay ? planner.chrome.cockpitText : planner.chrome.text },
          ]}
        >
          {copy}
        </Text>
      ))}
    </View>
  );
}

export function StartTimeComparison({
  planner,
  overlay = false,
  selectedPlan,
  referencePlan,
}: {
  planner: Planner;
  overlay?: boolean;
  selectedPlan?: EvaluatedRunV3 | null;
  referencePlan?: EvaluatedRunV3 | null;
}) {
  const { fontScale } = useWindowDimensions();
  const reference =
    referencePlan === undefined
      ? (recommendationForStartDay(planner.startRecommendation, planner.startTime, {
          startMinutes: planner.acceptableStartMinutes,
          endMinutes: planner.acceptableEndMinutes,
          weeklySchedule: planner.weeklyStartSchedule,
          timezone: planner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        })?.winner?.plan ?? null)
      : referencePlan;
  const comparison = compareRunStarts(
    selectedPlan === undefined ? planner.displayContext.plan : selectedPlan,
    reference,
    planner.temperatureUnit,
    planner.timezone,
  );
  const secondary = overlay ? planner.chrome.cockpitTextSecondary : planner.chrome.textSecondary;
  if (overlay) {
    const isSelected =
      planner.startSelectionMode === 'selected' || planner.startTime !== planner.committedStartTime;
    const summary =
      comparison.status === 'selected' || isSelected ? explorerComparisonSummary(comparison) : null;
    return (
      <View
        style={{
          gap: SP[1],
          marginTop: SP[1],
          minHeight: TYPE.support.lineHeight * fontScale * (fontScale >= 1.3 ? 2 : 1),
        }}
      >
        {summary ? (
          <Text
            testID={
              comparison.status === 'selected' ? 'explorer-best-time' : 'explorer-start-difference'
            }
            accessibilityLabel={`${summary}; ${comparison.reference}`}
            numberOfLines={fontScale >= 1.3 ? undefined : 1}
            adjustsFontSizeToFit={fontScale < 1.3}
            minimumFontScale={0.85}
            style={[TYPE.support, { color: secondary }]}
          >
            {summary}
          </Text>
        ) : null}
        {comparison.warning ? (
          <Text style={[TYPE.support, { color: planner.chrome.warnInk }]}>
            {comparison.warning}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View
      testID="start-time-comparison"
      style={{
        gap: SP[1],
        minHeight: (TYPE.caption.lineHeight + TYPE.support.lineHeight) * fontScale + SP[1],
      }}
    >
      <Text testID="comparison-reference" style={[TYPE.caption, { color: secondary }]}>
        {comparison.reference}
      </Text>
      {comparison.warning ? (
        <Text style={[TYPE.support, { color: planner.chrome.warnInk }]}>{comparison.warning}</Text>
      ) : null}
      {comparison.observations.length > 0 ? (
        <Text
          testID="comparison-observations"
          style={[
            TYPE.support,
            {
              color: overlay ? planner.chrome.cockpitText : planner.chrome.text,
            },
          ]}
        >
          {comparison.observations.join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}
