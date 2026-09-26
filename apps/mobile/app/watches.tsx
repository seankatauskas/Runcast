import type { Watch } from '@runcast/contracts';
import { fmtPace } from '@runcast/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { ActionButton, SectionHeader, Surface } from '../src/design/Primitives';
import { AppIcon } from '../src/design/Icon';
import {
  notificationReadinessPresentation,
  shouldOfferNotificationSetup,
} from '../src/notifications/readiness';
import {
  WATCH_RESULT_LABELS,
  nextOccurrenceSummary,
  weekdaySummary,
} from '../src/notifications/watchPresentation';
import { usePlanner } from '../src/state';
import { RADIUS, SP, TYPE } from '../src/theme';

const DAYS = [
  { label: 'S', bit: 1 },
  { label: 'M', bit: 2 },
  { label: 'T', bit: 4 },
  { label: 'W', bit: 8 },
  { label: 'T', bit: 16 },
  { label: 'F', bit: 32 },
  { label: 'S', bit: 64 },
] as const;

function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

export default function WatchesScreen() {
  const auth = useAuth();
  const planner = usePlanner();
  const router = useRouter();
  const params = useLocalSearchParams<{
    routeId?: string | string[];
    pendingRouteId?: string | string[];
    routeGeometry?: string | string[];
  }>();
  const requestedRouteId = Array.isArray(params.routeId) ? params.routeId[0] : params.routeId;
  const pendingRouteId = Array.isArray(params.pendingRouteId)
    ? params.pendingRouteId[0]
    : params.pendingRouteId;
  const routeGeometry = Array.isArray(params.routeGeometry)
    ? params.routeGeometry[0]
    : params.routeGeometry;
  const uploadPrompted = useRef(false);
  const insets = useSafeAreaInsets();
  const [watches, setWatches] = useState<Watch[]>([]);
  const [routeId, setRouteId] = useState(requestedRouteId ?? auth.cloudRoutes[0]?.summary.id ?? '');
  const [weekdays, setWeekdays] = useState(62);
  const [startMinutes, setStartMinutes] = useState(6 * 60);
  const [endMinutes, setEndMinutes] = useState(8 * 60);
  const [speed, setSpeed] = useState(planner.speed);
  const [leadMinutes, setLeadMinutes] = useState<30 | 60 | 90>(60);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void auth.getWatches().then(setWatches);
  }, []);

  useEffect(() => {
    if (
      requestedRouteId &&
      auth.cloudRoutes.some((bundle) => bundle.summary.id === requestedRouteId)
    ) {
      setRouteId(requestedRouteId);
    }
  }, [auth.cloudRoutes, requestedRouteId]);

  useEffect(() => {
    if (!pendingRouteId || !routeGeometry || auth.status !== 'authenticated') return;
    const saved = auth.routeSummaries.find((route) => route.geometryIdentity === routeGeometry);
    if (saved) {
      setRouteId(saved.id);
      return;
    }
    if (uploadPrompted.current) return;
    const selected = planner.routes.find((entry) => entry.legacyRoute.id === pendingRouteId);
    if (!selected) {
      setMessage('The selected route is no longer available on this device.');
      return;
    }
    uploadPrompted.current = true;
    Alert.alert(
      'Save route to your account?',
      'Route Watches require a cloud-saved route. Runcast will upload this route only if you continue.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Save and continue',
          onPress: () =>
            void auth
              .saveRoute(
                selected.legacyRoute,
                selected.legacyCoverage,
                selected.originalGpx ?? undefined,
              )
              .then(async (result) => {
                if (result === 'queued') {
                  setMessage(
                    'Offline: route upload is queued. Watch setup can continue after sync.',
                  );
                  return;
                }
                await auth.syncNow();
                setMessage('Route saved. Finish the watch schedule below.');
              })
              .catch((error) => {
                uploadPrompted.current = false;
                setMessage(error instanceof Error ? error.message : 'Could not save the route.');
              }),
        },
      ],
    );
  }, [auth.status, auth.routeSummaries, pendingRouteId, planner.routes, routeGeometry]);

  const selectedBundle = useMemo(
    () => auth.cloudRoutes.find((bundle) => bundle.summary.id === routeId),
    [auth.cloudRoutes, routeId],
  );
  const notificationStatus = notificationReadinessPresentation(auth.notificationReadiness);

  async function create(): Promise<void> {
    if (!selectedBundle) return;
    if (!selectedBundle.timezone) {
      setMessage('Sync this route to determine its timezone before creating a watch.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await auth.createWatch({
        routeId: selectedBundle.summary.id,
        weekdays,
        timezone: selectedBundle.timezone,
        startMinutes,
        endMinutes,
        speed,
        leadMinutes,
        enabled: true,
      });
      setMessage(result === 'queued' ? 'Offline: watch creation is queued.' : 'Watch created.');
      setWatches(await auth.getWatches());
      if (result === 'saved') offerNotificationSetup();
      void auth.refreshNotificationReadiness();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the watch.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(watch: Watch): Promise<void> {
    const enabled = !watch.enabled;
    setWatches((current) =>
      current.map((item) => (item.id === watch.id ? { ...item, enabled } : item)),
    );
    try {
      const result = await auth.setWatchEnabled(watch, enabled);
      if (result === 'saved') {
        setWatches(await auth.getWatches());
        if (enabled) offerNotificationSetup();
      } else {
        setMessage(`Offline: watch ${enabled ? 'enablement' : 'pause'} is queued.`);
      }
      void auth.refreshNotificationReadiness();
    } catch (error) {
      setWatches((current) =>
        current.map((item) => (item.id === watch.id ? { ...item, enabled: watch.enabled } : item)),
      );
      setMessage(error instanceof Error ? error.message : 'Could not update the watch.');
    }
  }

  async function remove(watch: Watch): Promise<void> {
    try {
      await auth.deleteWatch(watch);
      setWatches((current) => current.filter((item) => item.id !== watch.id));
      void auth.refreshNotificationReadiness();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete the watch.');
    }
  }

  function offerNotificationSetup(): void {
    if (!shouldOfferNotificationSetup(auth.notificationReadiness)) return;
    if (auth.notificationReadiness.project === 'missing') {
      setMessage('This build is missing notification configuration. The watch is still active.');
      return;
    }
    if (auth.notificationReadiness.permission === 'denied') {
      Alert.alert(
        'Allow route reminders in Settings?',
        'The watch is active, but Runcast cannot notify this device until notifications are allowed.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => void Linking.openSettings(),
          },
        ],
      );
      return;
    }
    Alert.alert(
      'Enable route reminders?',
      'Get an optional notification when Runcast finds a start in this watch window.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Enable',
          onPress: () =>
            void auth.enableNotifications().catch((error) => {
              setMessage(error instanceof Error ? error.message : 'Could not enable reminders.');
            }),
        },
      ],
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: planner.chrome.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
    >
      <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
        Your selected route window is checked every 15 minutes. Notifications are optional.
      </Text>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.message,
            { color: planner.chrome.text, backgroundColor: planner.chrome.surfaceRaised },
          ]}
        >
          {message}
        </Text>
      ) : null}

      <SectionHeader title="New watch" chrome={planner.chrome} />
      <Surface chrome={planner.chrome} style={styles.surface}>
        {auth.cloudRoutes.length ? (
          <>
            <Text style={[TYPE.section, { color: planner.chrome.text }]}>Saved route</Text>
            <View style={styles.wrap}>
              {auth.cloudRoutes.map((bundle) => {
                const selected = routeId === bundle.summary.id;
                return (
                  <Pressable
                    key={bundle.summary.id}
                    onPress={() => setRouteId(bundle.summary.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={[
                      styles.choice,
                      {
                        backgroundColor: selected
                          ? planner.chrome.controlActive
                          : planner.chrome.controlBg,
                        borderColor: planner.chrome.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        TYPE.control,
                        {
                          color: selected ? planner.chrome.controlActiveText : planner.chrome.text,
                        },
                      ]}
                    >
                      {bundle.summary.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[TYPE.section, { color: planner.chrome.text }]}>Weekdays</Text>
            <View style={styles.dayRow}>
              {DAYS.map((day, index) => {
                const selected = (weekdays & day.bit) !== 0;
                return (
                  <Pressable
                    key={index}
                    onPress={() => {
                      const next = selected ? weekdays & ~day.bit : weekdays | day.bit;
                      if (next) setWeekdays(next);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    style={[
                      styles.day,
                      {
                        backgroundColor: selected
                          ? planner.chrome.controlActive
                          : planner.chrome.controlBg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        TYPE.label,
                        {
                          color: selected
                            ? planner.chrome.controlActiveText
                            : planner.chrome.textSecondary,
                        },
                      ]}
                    >
                      {day.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[TYPE.section, { color: planner.chrome.text }]}>
              Same-day start window
            </Text>
            <View style={styles.timeRow}>
              <TimeControl
                label="Earliest"
                value={startMinutes}
                onChange={(value) => {
                  const next = Math.max(0, Math.min(value, endMinutes - 60));
                  setStartMinutes(next);
                }}
              />
              <TimeControl
                label="Latest"
                value={endMinutes}
                onChange={(value) => {
                  const next = Math.min(1425, Math.max(value, startMinutes + 60));
                  setEndMinutes(next);
                }}
              />
            </View>

            <Text style={[TYPE.section, { color: planner.chrome.text }]}>Expected flat pace</Text>
            <View style={styles.wrap}>
              <ActionButton
                label="Slower"
                chrome={planner.chrome}
                onPress={() => setSpeed((value) => Math.max(0.5, value - 0.05))}
                variant="secondary"
              />
              <Text style={[TYPE.control, { color: planner.chrome.text }]}>
                {fmtPace(speed, planner.units)}
              </Text>
              <ActionButton
                label="Faster"
                chrome={planner.chrome}
                onPress={() => setSpeed((value) => Math.min(15, value + 0.05))}
                variant="secondary"
              />
            </View>

            <Text style={[TYPE.section, { color: planner.chrome.text }]}>Reminder lead time</Text>
            <View style={styles.wrap}>
              {([30, 60, 90] as const).map((lead) => (
                <Pressable
                  key={lead}
                  onPress={() => setLeadMinutes(lead)}
                  style={[
                    styles.choice,
                    {
                      backgroundColor:
                        leadMinutes === lead
                          ? planner.chrome.controlActive
                          : planner.chrome.controlBg,
                      borderColor: planner.chrome.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      TYPE.control,
                      {
                        color:
                          leadMinutes === lead
                            ? planner.chrome.controlActiveText
                            : planner.chrome.text,
                      },
                    ]}
                  >
                    {lead} min
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
              A run may finish after the selected window. Cross-midnight windows are not supported.
            </Text>
            <ActionButton
              label={busy ? 'Creating…' : 'Create watch'}
              chrome={planner.chrome}
              onPress={() => void create()}
            />
          </>
        ) : (
          <View style={styles.emptyWatch}>
            <View style={[styles.emptyWatchIcon, { backgroundColor: planner.chrome.controlBg }]}>
              <AppIcon name="eye" size={24} color={planner.chrome.accentInk} />
            </View>
            <View style={styles.emptyWatchCopy}>
              <Text style={[TYPE.section, { color: planner.chrome.text }]}>Watch a route</Text>
              <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
                {auth.status === 'authenticated'
                  ? 'Save the current route to your account before creating a watch.'
                  : 'Sign in, then save a route to create a recurring forecast window.'}
              </Text>
            </View>
            <ActionButton
              label={auth.status === 'authenticated' ? 'Save a route' : 'Sign in to continue'}
              chrome={planner.chrome}
              onPress={() => router.push('/account')}
              variant={auth.status === 'authenticated' ? 'secondary' : 'primary'}
            />
          </View>
        )}
      </Surface>

      {watches.length ? (
        <SectionHeader title="Your watches" detail={`${watches.length}`} chrome={planner.chrome} />
      ) : null}
      {watches.map((watch) => {
        const route = auth.cloudRoutes.find(
          (bundle) => bundle.summary.id === watch.routeId,
        )?.summary;
        const latest = auth.latestWatchResults.find((result) => result.watchId === watch.id);
        return (
          <Surface key={watch.id} chrome={planner.chrome} style={styles.watchCard}>
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.control, { color: planner.chrome.text }]}>
                {route?.name ?? 'Saved route'}
              </Text>
              <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
                {clock(watch.startMinutes)}–{clock(watch.endMinutes)} · {watch.leadMinutes} min lead
              </Text>
              <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
                {weekdaySummary(watch.weekdayNames ?? [])}
              </Text>
              <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
                {watch.enabled ? 'Enabled' : 'Paused'}
              </Text>
              <Text style={[TYPE.support, { color: planner.chrome.textFaint }]}>
                {nextOccurrenceSummary(watch)}
              </Text>
              <Text
                style={[
                  TYPE.control,
                  {
                    color: latest
                      ? latest.status === 'recommended'
                        ? planner.chrome.good
                        : latest.status === 'caution'
                          ? planner.chrome.warn
                          : planner.chrome.danger
                      : planner.chrome.textSecondary,
                  },
                ]}
              >
                {latest ? WATCH_RESULT_LABELS[latest.status] : 'Scheduled'}
              </Text>
              <Text style={[TYPE.caption, { color: planner.chrome.textFaint }]}>
                {notificationStatus.title} · in-app results available
              </Text>
            </View>
            <ActionButton
              label="Details"
              chrome={planner.chrome}
              onPress={() => router.push(`/watches/${watch.id}`)}
              variant="secondary"
            />
            <ActionButton
              label={watch.enabled ? 'Pause' : 'Enable'}
              chrome={planner.chrome}
              onPress={() => void toggle(watch)}
              variant="ghost"
            />
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert('Delete watch?', route?.name ?? 'Saved route', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => void remove(watch) },
                ])
              }
              style={styles.delete}
            >
              <Text style={[TYPE.control, { color: planner.chrome.danger }]}>Delete</Text>
            </Pressable>
          </Surface>
        );
      })}
    </ScrollView>
  );

  function TimeControl({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
  }) {
    return (
      <View style={[styles.timeControl, { borderColor: planner.chrome.border }]}>
        <Text style={[TYPE.label, { color: planner.chrome.textFaint }]}>{label}</Text>
        <Text style={[TYPE.control, { color: planner.chrome.text }]}>{clock(value)}</Text>
        <View style={styles.stepRow}>
          <ActionButton
            label="−15"
            chrome={planner.chrome}
            onPress={() => onChange(value - 15)}
            variant="secondary"
          />
          <ActionButton
            label="+15"
            chrome={planner.chrome}
            onPress={() => onChange(value + 15)}
            variant="secondary"
          />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: SP[4],
    gap: SP[5],
  },
  surface: { gap: SP[3] },
  message: { padding: SP[3], borderRadius: RADIUS.md, overflow: 'hidden' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SP[2] },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SP[3],
    borderRadius: RADIUS.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SP[1] },
  day: {
    width: 40,
    height: 44,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRow: { flexDirection: 'row', gap: SP[2] },
  timeControl: {
    flex: 1,
    padding: SP[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    gap: SP[2],
  },
  stepRow: { flexDirection: 'row', gap: SP[1] },
  watchCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SP[3] },
  emptyWatch: { gap: SP[3] },
  emptyWatchIcon: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWatchCopy: { gap: SP[1] },
  delete: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SP[2] },
});
