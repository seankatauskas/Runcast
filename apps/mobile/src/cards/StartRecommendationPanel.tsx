import { fmtClock, fmtDay } from '@runcast/core';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Planner } from '../state';
import { ActionButton } from '../design/Primitives';
import { RADIUS, SP, TYPE } from '../theme';
import { startRecommendationPresentation } from './startRecommendationPresentation';

export function StartRecommendationPanel({
  planner,
  variant = 'hero',
}: {
  planner: Planner;
  variant?: 'hero' | 'compact';
}) {
  const presentation = startRecommendationPresentation({
    recommendation: planner.startRecommendation,
    unavailableReasons: planner.startRecommendationUnavailableReasons,
    syncState: planner.planningBundleSyncState,
    environmentExpired: planner.environmentExpired,
  });
  const winner = presentation.winnerStartTime;
  const visibleReasons =
    presentation.status === 'recommended' ? [] : presentation.reasons.slice(0, 2);
  const color =
    presentation.status === 'recommended'
      ? planner.chrome.good
      : presentation.status === 'caution'
        ? planner.chrome.warn
        : presentation.status === 'no-suitable-window'
          ? planner.chrome.danger
          : planner.chrome.textFaint;
  const winnerIsSelected = winner !== null && Math.abs(winner - planner.startTime) < 15 * 60_000;
  const loading =
    planner.weatherStatus === 'loading' &&
    planner.startRecommendation === null &&
    planner.planningBundleSyncState === null &&
    !planner.environmentExpired;

  if (loading) {
    return (
      <View
        style={[
          styles.panel,
          variant === 'hero' ? styles.heroPanel : styles.compactPanel,
          { backgroundColor: planner.chrome.surfaceMuted, borderColor: planner.chrome.border },
        ]}
        accessibilityLiveRegion="polite"
      >
        <View style={[styles.accentRail, { backgroundColor: planner.chrome.accentInk }]} />
        <View style={styles.loadingRow}>
          <ActivityIndicator color={planner.chrome.accentInk} />
          <View style={styles.copy}>
            <Text style={[TYPE.label, { color: planner.chrome.accentInk }]}>FORECASTING</Text>
            <Text
              style={[
                variant === 'hero' ? TYPE.title : TYPE.control,
                { color: planner.chrome.text },
              ]}
            >
              Finding your best window
            </Text>
            <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
              Comparing conditions across the full route.
            </Text>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.panel,
        variant === 'hero' ? styles.heroPanel : styles.compactPanel,
        {
          backgroundColor: planner.chrome.surfaceMuted,
          borderColor: planner.chrome.border,
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.accentRail, { backgroundColor: color }]} />
      <View style={styles.copy}>
        <View style={styles.labelRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[TYPE.label, { color }]}>{presentation.label}</Text>
          {winnerIsSelected ? (
            <Text style={[styles.selectedLabel, { color: planner.chrome.textFaint }]}>
              SELECTED
            </Text>
          ) : null}
        </View>
        {winner === null ? (
          <Text
            style={[variant === 'hero' ? TYPE.title : TYPE.control, { color: planner.chrome.text }]}
          >
            {presentation.title}
          </Text>
        ) : (
          <View style={styles.timeBlock}>
            <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
              {fmtDay(winner, planner.timezone)}
            </Text>
            <Text
              style={[
                variant === 'hero' ? TYPE.hero : TYPE.title,
                variant === 'compact' && styles.compactTime,
                { color: planner.chrome.text },
              ]}
            >
              {fmtClock(winner, planner.timezone)}
            </Text>
          </View>
        )}
        <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
          {presentation.detail}
        </Text>
        {visibleReasons.map((reason) => (
          <View key={reason.code} style={styles.reasonRow}>
            <View style={[styles.reasonDash, { backgroundColor: color }]} />
            <Text style={[TYPE.caption, { color: planner.chrome.textSecondary, flex: 1 }]}>
              {reason.label}
            </Text>
          </View>
        ))}
      </View>
      {winner !== null && !winnerIsSelected ? (
        <View style={variant === 'hero' ? styles.heroAction : styles.compactAction}>
          <ActionButton
            label="Use best time"
            chrome={planner.chrome}
            onPress={() => planner.setStartTime(winner)}
            variant={variant === 'hero' ? 'primary' : 'secondary'}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
  },
  heroPanel: { padding: SP[4], gap: SP[3] },
  compactPanel: { padding: SP[3], gap: SP[2] },
  accentRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  copy: { minWidth: 0, gap: SP[1] },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SP[3] },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: SP[2] },
  dot: { width: 7, height: 7, borderRadius: 4 },
  selectedLabel: { ...TYPE.label, marginLeft: 'auto', fontSize: 10 },
  timeBlock: { gap: 1 },
  compactTime: { fontSize: 24, lineHeight: 29 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: SP[2] },
  reasonDash: { width: 10, height: 2, borderRadius: 1 },
  heroAction: { alignItems: 'flex-start', paddingTop: SP[1] },
  compactAction: { alignItems: 'flex-start' },
});
