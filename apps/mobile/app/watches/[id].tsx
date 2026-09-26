import type { Watch, WatchResultSummary } from '@runcast/contracts';
import { fmtPace } from '@runcast/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { ActionButton, SectionHeader, Surface } from '../../src/design/Primitives';
import { WATCH_RESULT_LABELS, weekdaySummary } from '../../src/notifications/watchPresentation';
import { usePlanner } from '../../src/state';
import { RADIUS, SP, TYPE } from '../../src/theme';

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
  return `${hour % 12 || 12}:${minute.toString().padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function resultTime(result: WatchResultSummary, timezone: string): string {
  const date = new Date(result.recommendedStart ?? result.evaluatedAt);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function namesForWeekdays(weekdays: number): Watch['weekdayNames'] {
  const names = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ] as const;
  return names.filter((_name, index) => (weekdays & (1 << index)) !== 0);
}

export default function WatchDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const auth = useAuth();
  const planner = usePlanner();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [watch, setWatch] = useState<Watch | null>(null);
  const [history, setHistory] = useState<WatchResultSummary[]>([]);
  const [draft, setDraft] = useState<Watch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void Promise.all([auth.getWatches(), auth.getWatchResults(id)]).then(([watches, results]) => {
      const found = watches.find((candidate) => candidate.id === id) ?? null;
      setWatch(found);
      setDraft(found);
      setHistory(results);
      setLoaded(true);
    });
  }, [id]);

  if (!id || !watch || !draft) {
    return (
      <View style={[styles.center, { backgroundColor: planner.chrome.bg }]}>
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          {loaded ? 'This watch or its saved route was deleted.' : 'Loading watch…'}
        </Text>
        {loaded ? (
          <ActionButton
            label="Back to watches"
            chrome={planner.chrome}
            onPress={() => router.replace('/watches')}
          />
        ) : null}
      </View>
    );
  }

  const route = auth.cloudRoutes.find((bundle) => bundle.summary.id === watch.routeId)?.summary;

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await auth.updateWatch(watch!, {
        ...(draft!.weekdays === watch!.weekdays ? {} : { weekdays: draft!.weekdays }),
        ...(draft!.startMinutes === watch!.startMinutes
          ? {}
          : { startMinutes: draft!.startMinutes }),
        ...(draft!.endMinutes === watch!.endMinutes ? {} : { endMinutes: draft!.endMinutes }),
        ...(draft!.speed === watch!.speed ? {} : { speed: draft!.speed }),
        ...(draft!.leadMinutes === watch!.leadMinutes ? {} : { leadMinutes: draft!.leadMinutes }),
        ...(draft!.enabled === watch!.enabled ? {} : { enabled: draft!.enabled }),
      });
      const refreshed = (await auth.getWatches()).find((candidate) => candidate.id === id);
      if (refreshed) {
        setWatch(refreshed);
        setDraft(refreshed);
      }
      setMessage(result === 'queued' ? 'Offline: edits are queued.' : 'Watch updated.');
    } catch (error) {
      const refreshed = (await auth.getWatches()).find((candidate) => candidate.id === id);
      if (refreshed) {
        setWatch(refreshed);
        setDraft(refreshed);
      }
      setMessage(
        error instanceof Error
          ? `${error.message} The latest server version has been loaded.`
          : 'Could not update this watch.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: planner.chrome.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
    >
      <SectionHeader title={route?.name ?? 'Saved route'} chrome={planner.chrome} />
      <Surface chrome={planner.chrome} style={styles.surface}>
        <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
          The route is fixed for this watch. Create another watch to monitor a different route.
        </Text>
        <Text style={[TYPE.section, { color: planner.chrome.text }]}>Weekdays</Text>
        <View style={styles.dayRow}>
          {DAYS.map((day, index) => {
            const selected = (draft.weekdays & day.bit) !== 0;
            return (
              <Pressable
                key={index}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  const next = selected ? draft.weekdays & ~day.bit : draft.weekdays | day.bit;
                  if (next) setDraft({ ...draft, weekdays: next });
                }}
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
        <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
          {weekdaySummary(namesForWeekdays(draft.weekdays))}
        </Text>

        <Text style={[TYPE.section, { color: planner.chrome.text }]}>Same-day start window</Text>
        <View style={styles.row}>
          <StepControl
            label="Earliest"
            value={clock(draft.startMinutes)}
            onDown={() =>
              setDraft({
                ...draft,
                startMinutes: Math.max(0, Math.floor((draft.startMinutes - 1) / 15) * 15),
              })
            }
            onUp={() =>
              setDraft({
                ...draft,
                startMinutes: Math.min(
                  draft.endMinutes - 60,
                  Math.ceil((draft.startMinutes + 1) / 15) * 15,
                ),
              })
            }
          />
          <StepControl
            label="Latest"
            value={clock(draft.endMinutes)}
            onDown={() =>
              setDraft({
                ...draft,
                endMinutes: Math.max(
                  draft.startMinutes + 60,
                  Math.floor((draft.endMinutes - 1) / 15) * 15,
                ),
              })
            }
            onUp={() =>
              setDraft({
                ...draft,
                endMinutes: Math.min(1425, Math.ceil((draft.endMinutes + 1) / 15) * 15),
              })
            }
          />
        </View>

        <Text style={[TYPE.section, { color: planner.chrome.text }]}>Expected flat pace</Text>
        <View style={styles.inline}>
          <ActionButton
            label="Slower"
            chrome={planner.chrome}
            onPress={() => setDraft({ ...draft, speed: Math.max(0.5, draft.speed - 0.05) })}
            variant="secondary"
          />
          <Text style={[TYPE.control, { color: planner.chrome.text }]}>
            {fmtPace(draft.speed, planner.units)}
          </Text>
          <ActionButton
            label="Faster"
            chrome={planner.chrome}
            onPress={() => setDraft({ ...draft, speed: Math.min(15, draft.speed + 0.05) })}
            variant="secondary"
          />
        </View>

        <Text style={[TYPE.section, { color: planner.chrome.text }]}>Initial notice</Text>
        <View style={styles.inline}>
          {([30, 60, 90] as const).map((lead) => (
            <Pressable
              key={lead}
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.leadMinutes === lead }}
              onPress={() => setDraft({ ...draft, leadMinutes: lead })}
              style={[
                styles.choice,
                {
                  backgroundColor:
                    draft.leadMinutes === lead
                      ? planner.chrome.controlActive
                      : planner.chrome.controlBg,
                },
              ]}
            >
              <Text
                style={[
                  TYPE.control,
                  {
                    color:
                      draft.leadMinutes === lead
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
        <ActionButton
          label={draft.enabled ? 'Pause watch' : 'Enable watch'}
          chrome={planner.chrome}
          onPress={() => setDraft({ ...draft, enabled: !draft.enabled })}
          variant="secondary"
        />
        <ActionButton
          label={busy ? 'Saving…' : 'Save changes'}
          chrome={planner.chrome}
          onPress={() => void save()}
        />
        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[TYPE.support, { color: planner.chrome.text }]}
          >
            {message}
          </Text>
        ) : null}
      </Surface>

      <SectionHeader
        title="Recent results"
        detail={`${history.length}/7`}
        chrome={planner.chrome}
      />
      {history.length ? (
        history.map((result) => (
          <Pressable
            key={result.evaluationId}
            accessibilityRole="button"
            accessibilityLabel={`${WATCH_RESULT_LABELS[result.status]}, ${resultTime(result, watch.timezone)}`}
            onPress={() =>
              router.push(
                `/watch-results/${result.evaluationId}?watchId=${encodeURIComponent(watch.id)}`,
              )
            }
          >
            <Surface chrome={planner.chrome} style={styles.result}>
              <View style={{ flex: 1 }}>
                <Text style={[TYPE.control, { color: planner.chrome.text }]}>
                  {WATCH_RESULT_LABELS[result.status]}
                </Text>
                <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
                  {result.recommendedStart ? 'Recommended start · ' : ''}
                  {resultTime(result, watch.timezone)}
                </Text>
              </View>
              <Text style={[TYPE.control, { color: planner.chrome.accentInk }]}>Open</Text>
            </Surface>
          </Pressable>
        ))
      ) : (
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          Results appear here after the first scheduled evaluation.
        </Text>
      )}
    </ScrollView>
  );

  function StepControl({
    label,
    value,
    onDown,
    onUp,
  }: {
    label: string;
    value: string;
    onDown: () => void;
    onUp: () => void;
  }) {
    return (
      <View style={[styles.step, { borderColor: planner.chrome.border }]}>
        <Text style={[TYPE.label, { color: planner.chrome.textFaint }]}>{label}</Text>
        <Text style={[TYPE.control, { color: planner.chrome.text }]}>{value}</Text>
        <View style={styles.inline}>
          <ActionButton label="−15" chrome={planner.chrome} onPress={onDown} variant="secondary" />
          <ActionButton label="+15" chrome={planner.chrome} onPress={onUp} variant="secondary" />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: SP[4],
    gap: SP[5],
  },
  surface: { gap: SP[3] },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SP[1] },
  day: {
    width: 40,
    height: 44,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', gap: SP[2] },
  inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP[2] },
  step: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    padding: SP[3],
    gap: SP[2],
  },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SP[3],
    borderRadius: RADIUS.full,
  },
  result: { flexDirection: 'row', alignItems: 'center', gap: SP[3] },
});
