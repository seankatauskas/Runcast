import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { AppIcon } from '../src/design/Icon';
import { SectionHeader, Surface } from '../src/design/Primitives';
import { usePlanner, type ThemePreference } from '../src/state';
import { RADIUS, SP, TYPE } from '../src/theme';

function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
}) {
  const { chrome } = usePlanner();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.segmented, { backgroundColor: chrome.controlBg, borderColor: chrome.border }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            style={[
              styles.segment,
              selected && {
                backgroundColor: chrome.surfaceRaised,
                borderColor: chrome.borderStrong,
              },
            ]}
          >
            <Text style={[TYPE.control, { color: selected ? chrome.text : chrome.textSecondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PreferenceRow({
  title,
  detail,
  children,
  last = false,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
  last?: boolean;
}) {
  const { chrome } = usePlanner();
  return (
    <View
      style={[
        styles.preferenceRow,
        { borderColor: chrome.border },
        last && styles.preferenceRowLast,
      ]}
    >
      <View style={styles.preferenceCopy}>
        <Text style={[TYPE.control, { color: chrome.text }]}>{title}</Text>
        {detail ? <Text style={[TYPE.caption, { color: chrome.textFaint }]}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const planner = usePlanner();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const syncMessage =
    auth.status !== 'authenticated'
      ? 'Saved on this device'
      : auth.preferenceSyncStatus === 'syncing'
        ? 'Syncing…'
        : auth.preferenceSyncStatus === 'offline'
          ? 'Offline · will sync when connected'
          : auth.preferenceSyncStatus === 'conflict'
            ? 'Settings changed elsewhere. Server settings were restored.'
            : 'Saved to your account';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: planner.chrome.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
    >
      <Text
        accessibilityLiveRegion="polite"
        style={[TYPE.support, { color: planner.chrome.textFaint }]}
      >
        {syncMessage}
      </Text>

      <SectionHeader title="Display preferences" chrome={planner.chrome} />
      <Surface chrome={planner.chrome} style={styles.surface}>
        <PreferenceRow title="Distance">
          <SegmentedChoice
            value={planner.units}
            options={[
              { label: 'mi', value: 'imperial' },
              { label: 'km', value: 'metric' },
            ]}
            onChange={planner.setUnits}
          />
        </PreferenceRow>
        <PreferenceRow title="Temperature">
          <SegmentedChoice
            value={planner.temperatureUnit}
            options={[
              { label: '°F', value: 'fahrenheit' },
              { label: '°C', value: 'celsius' },
            ]}
            onChange={planner.setTemperatureUnit}
          />
        </PreferenceRow>
        <PreferenceRow title="Appearance" last>
          <SegmentedChoice<ThemePreference>
            value={planner.themePreference}
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
            onChange={planner.setThemePreference}
          />
        </PreferenceRow>
      </Surface>

      <SectionHeader title="Planning preferences" chrome={planner.chrome} />
      <Pressable
        testID="open-running-schedule"
        accessibilityRole="button"
        accessibilityLabel="Running schedule"
        accessibilityHint="Choose when you’re available to run"
        onPress={() => router.push('/running-schedule')}
        style={({ pressed }) => [
          styles.scheduleRow,
          {
            backgroundColor: pressed ? planner.chrome.controlBg : planner.chrome.surfaceRaised,
            borderColor: planner.chrome.border,
          },
        ]}
      >
        <View style={styles.scheduleCopy}>
          <Text style={[TYPE.control, { color: planner.chrome.text }]}>Running schedule</Text>
          <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
            Choose when you’re available to run.
          </Text>
        </View>
        <AppIcon name="chevron-right" size={18} color={planner.chrome.textFaint} />
      </Pressable>

      <Text style={[TYPE.caption, { color: planner.chrome.textFaint }]}>
        Expected flat pace is edited from the run card and syncs as your account default.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: SP[4],
    gap: SP[4],
  },
  surface: { paddingVertical: 0 },
  preferenceRow: {
    minHeight: 72,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: SP[3],
  },
  preferenceRowLast: { borderBottomWidth: 0 },
  scheduleRow: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    padding: SP[4],
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scheduleCopy: { flex: 1, gap: SP[1] },
  preferenceCopy: { flexGrow: 1, minWidth: 120, gap: 2 },
  segmented: {
    minHeight: 44,
    minWidth: 144,
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    padding: 2,
  },
  segment: {
    minWidth: 48,
    minHeight: 40,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    paddingHorizontal: SP[2],
  },
});
