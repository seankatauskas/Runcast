import type { Watch, WatchResultDetail } from '@runcast/contracts';
import { fmtTemp, fmtWindSpeed, presentRunConditions, sunlightIntensityLevel } from '@runcast/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { recommendationReasonLabel } from '../../src/cards/startRecommendationPresentation';
import { ActionButton, SectionHeader, Surface } from '../../src/design/Primitives';
import { WATCH_RESULT_LABELS } from '../../src/notifications/watchPresentation';
import type { MinimalNotificationSnapshot } from '../../src/notifications/responseModel';
import { usePlanner } from '../../src/state';
import { SP, TYPE } from '../../src/theme';

function displayTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function forecastFreshness(detail: WatchResultDetail): string {
  if (!detail.forecastFetchedAt) return 'Forecast capture time unavailable';
  const minutes = Math.max(
    0,
    Math.round((Date.parse(detail.evaluatedAt) - Date.parse(detail.forecastFetchedAt)) / 60_000),
  );
  return minutes < 1
    ? 'Forecast captured at evaluation time'
    : `Forecast captured ${minutes} min before evaluation`;
}

function savedSunIntensity(plan: WatchResultDetail['runPlan'] & object): string {
  const dose =
    plan.schemaVersion === 3
      ? plan.physicalConditions.canopyAdjustedRadiationDoseJm2
      : plan.physicalConditions.radiationDoseJm2;
  const level = sunlightIntensityLevel(
    dose / plan.durationSeconds,
    plan.exposureSummary.daylightFraction > 0,
  );
  return (
    { none: 'None', minimal: 'Minimal', low: 'Low', moderate: 'Moderate', high: 'High' } as const
  )[level];
}

export default function WatchResultScreen() {
  const params = useLocalSearchParams<{
    evaluationId?: string | string[];
    watchId?: string | string[];
  }>();
  const evaluationId = Array.isArray(params.evaluationId)
    ? params.evaluationId[0]
    : params.evaluationId;
  const watchId = Array.isArray(params.watchId) ? params.watchId[0] : params.watchId;
  const auth = useAuth();
  const planner = usePlanner();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<WatchResultDetail | null>(null);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [fallback, setFallback] = useState<MinimalNotificationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (!evaluationId || !watchId) {
      setLoading(false);
      setUnavailable(true);
      return;
    }
    setLoading(true);
    setUnavailable(false);
    const [cachedFallback, watches] = await Promise.all([
      auth.getNotificationResultFallback(evaluationId),
      auth.getWatches(),
    ]);
    setFallback(cachedFallback);
    setWatch(watches.find((candidate) => candidate.id === watchId) ?? null);
    try {
      setDetail(await auth.getWatchResult(watchId, evaluationId));
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [auth.getNotificationResultFallback, auth.getWatchResult, evaluationId, watchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const routeId = fallback?.routeId ?? watch?.routeId;
  const routeBundle = auth.cloudRoutes.find((bundle) => bundle.summary.id === routeId);
  const routeName = fallback?.routeName ?? routeBundle?.summary.name ?? 'Saved route';
  const timezone = watch?.timezone ?? routeBundle?.timezone ?? 'UTC';

  if (!detail && (fallback || unavailable || !loading)) {
    const snapshotStatus = fallback?.snapshot.status;
    return (
      <View style={[styles.fallback, { backgroundColor: planner.chrome.bg }]}>
        <Text style={[TYPE.title, { color: planner.chrome.text }]}>{routeName}</Text>
        <Text style={[TYPE.section, { color: planner.chrome.text }]}>
          {snapshotStatus ? WATCH_RESULT_LABELS[snapshotStatus] : 'Result unavailable'}
        </Text>
        {fallback ? (
          <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
            {fallback.snapshot.status === 'no-suitable-window'
              ? 'Window begins'
              : 'Recommended start'}{' '}
            · {displayTime(fallback.start, timezone)}
          </Text>
        ) : null}
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary, textAlign: 'center' }]}>
          {fallback
            ? 'Condition details are unavailable offline. The notification summary is saved on this device.'
            : 'This result could not be loaded. Check your connection and try again.'}
        </Text>
        <ActionButton
          label="Retry"
          chrome={planner.chrome}
          onPress={() => void load()}
          variant="secondary"
        />
        {routeId ? (
          <ActionButton
            label="Open route"
            chrome={planner.chrome}
            onPress={() => router.push(`/routes/${encodeURIComponent(routeId)}`)}
          />
        ) : null}
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={[styles.fallback, { backgroundColor: planner.chrome.bg }]}>
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>Loading result…</Text>
      </View>
    );
  }

  const plan = detail.runPlan;
  const conditions = plan ? presentRunConditions(plan) : null;
  const effectiveRouteId = fallback?.routeId ?? watch?.routeId ?? plan?.routeId;
  const effectiveRouteName =
    fallback?.routeName ??
    auth.cloudRoutes.find((bundle) => bundle.summary.id === effectiveRouteId)?.summary.name ??
    'Saved route';
  const upcoming = detail.recommendedStart
    ? Date.parse(detail.recommendedStart) > Date.now()
    : false;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: planner.chrome.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
    >
      <SectionHeader title={effectiveRouteName} chrome={planner.chrome} />
      <Surface chrome={planner.chrome} style={styles.surface}>
        <Text style={[TYPE.label, { color: planner.chrome.textFaint }]}>SAVED WATCH RESULT</Text>
        <Text style={[TYPE.title, { color: planner.chrome.text }]}>
          {WATCH_RESULT_LABELS[detail.status]}
        </Text>
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          Occurrence {detail.occurrenceDate}
        </Text>
        <Text style={[TYPE.section, { color: planner.chrome.text }]}>
          {detail.recommendedStart
            ? `Recommended start · ${displayTime(detail.recommendedStart, timezone)}`
            : 'No recommended start'}
        </Text>
        <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
          Evaluated {displayTime(detail.evaluatedAt, timezone)} · {forecastFreshness(detail)}
        </Text>
        <Text style={[TYPE.caption, { color: planner.chrome.textFaint }]}>
          Advisory forecast guidance only. Conditions can change and this is not a safety claim.
        </Text>
      </Surface>

      {detail.reasonCodes.length ? (
        <Surface chrome={planner.chrome} style={styles.surface}>
          <Text style={[TYPE.section, { color: planner.chrome.text }]}>Why</Text>
          {detail.reasonCodes.slice(0, 3).map((reason) => (
            <Text key={reason} style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
              {recommendationReasonLabel(reason)}
            </Text>
          ))}
        </Surface>
      ) : null}

      {plan && conditions ? (
        <Surface chrome={planner.chrome} style={styles.conditions}>
          <ConditionRow label="Sun" value={savedSunIntensity(plan)} color={planner.chrome.sunInk} />
          <ConditionRow
            label="Air"
            value={`${fmtTemp(plan.physicalConditions.meanTemperatureC, planner.temperatureUnit)} average`}
            color={planner.chrome.temperatureInk}
          />
          <ConditionRow
            label="Rain"
            value={`${Math.round(plan.physicalConditions.peaks.precipitationProbabilityPct)}% peak chance`}
            color={planner.chrome.rainInk}
          />
          <ConditionRow
            label="Wind"
            value={`${conditions.windEffect.label} · gusts ${fmtWindSpeed(plan.physicalConditions.peaks.gustMs, planner.units)}`}
            color={planner.chrome.windInk}
            last
          />
        </Surface>
      ) : null}

      {effectiveRouteId ? (
        <ActionButton
          label={upcoming ? 'Open latest forecast' : 'Open route'}
          chrome={planner.chrome}
          onPress={() => {
            const path = `/routes/${encodeURIComponent(effectiveRouteId)}`;
            router.push(
              upcoming && detail.recommendedStart
                ? `${path}?start=${Date.parse(detail.recommendedStart)}`
                : path,
            );
          }}
        />
      ) : null}
    </ScrollView>
  );

  function ConditionRow({
    label,
    value,
    color,
    last = false,
  }: {
    label: string;
    value: string;
    color: string;
    last?: boolean;
  }) {
    return (
      <View style={[styles.conditionRow, !last && { borderBottomColor: planner.chrome.border }]}>
        <Text style={[TYPE.control, { color: planner.chrome.text }]}>{label}</Text>
        <Text style={[TYPE.body, { color, flex: 1, textAlign: 'right' }]}>{value}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[3],
    padding: SP[6],
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: SP[4],
    gap: SP[5],
  },
  surface: { gap: SP[2] },
  conditions: { paddingVertical: 0 },
  conditionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
