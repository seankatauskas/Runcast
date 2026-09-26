import { fmtDistance } from '@runcast/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { ActionButton, SectionHeader, Surface } from '../src/design/Primitives';
import { AppIcon } from '../src/design/Icon';
import { RouteThumbnail } from '../src/map/RouteThumbnail';
import { usePlanner, type RouteEntry } from '../src/state';
import { RADIUS, SP, TYPE } from '../src/theme';

function originLabel(entry: RouteEntry): string {
  switch (entry.origin) {
    case 'demo':
      return 'Demo route';
    case 'local':
      return 'On this device · original GPX retained';
    case 'cloud-gpx':
      return 'Runcast account · GPX';
    case 'cloud-strava':
      return 'Runcast account · Strava';
  }
}

export default function RouteLibraryScreen() {
  const planner = usePlanner();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<RouteEntry | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const editableRoutes = planner.routes.filter((route) => !route.isDemo);
  const demoRoutes = planner.routes.filter((route) => route.isDemo);

  function beginRename(route: RouteEntry): void {
    setEditing(route);
    setName(route.legacyRoute.name);
    setMessage(null);
  }

  async function finishRename(): Promise<void> {
    if (!editing || busy) return;
    setBusy(editing.legacyRoute.id);
    try {
      let syncResult: 'saved' | 'queued' = 'saved';
      if (editing.origin.startsWith('cloud-')) {
        const summary = auth.routeSummaries.find((route) => route.id === editing.legacyRoute.id);
        if (!summary) throw new Error('Cloud route metadata is unavailable. Sync and try again.');
        syncResult = await auth.renameCloudRoute(summary, name);
      }
      const savedName = await planner.renameRoute(editing.legacyRoute.id, name);
      setMessage(
        syncResult === 'queued'
          ? `${savedName} was renamed on this device and will sync when you’re online.`
          : `${savedName} was renamed.`,
      );
      setEditing(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not rename that route.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete(route: RouteEntry): void {
    Alert.alert(
      `Delete ${route.legacyRoute.name}?`,
      route.origin === 'local'
        ? 'This permanently removes the route and its original GPX from this device.'
        : 'This removes the route from your account and deletes its watches and cached forecasts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void removeRoute(route),
        },
      ],
    );
  }

  async function removeRoute(route: RouteEntry): Promise<void> {
    if (busy) return;
    setBusy(route.legacyRoute.id);
    setMessage(null);
    try {
      let syncResult: 'saved' | 'queued' = 'saved';
      if (route.origin.startsWith('cloud-')) {
        syncResult = await auth.deleteCloudRoute(route.legacyRoute.id);
      }
      await planner.deleteRoute(route.legacyRoute.id);
      setMessage(
        syncResult === 'queued'
          ? 'Route removed on this device. Account deletion will retry when you’re online.'
          : 'Route deleted.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete that route.');
    } finally {
      setBusy(null);
    }
  }

  async function saveToAccount(route: RouteEntry): Promise<void> {
    if (busy) return;
    setBusy(route.legacyRoute.id);
    setMessage(null);
    try {
      const result = await auth.saveRoute(
        route.legacyRoute,
        route.legacyCoverage,
        route.originalGpx ?? undefined,
      );
      setMessage(
        result === 'queued'
          ? 'Route upload queued and will retry when you’re online.'
          : 'Route saved to your account.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save that route.');
    } finally {
      setBusy(null);
    }
  }

  function row(route: RouteEntry, last: boolean) {
    const selected = planner.selected.legacyRoute.id === route.legacyRoute.id;
    return (
      <View
        key={route.legacyRoute.id}
        style={[
          styles.routeRow,
          { borderColor: planner.chrome.border },
          last && styles.routeRowLast,
        ]}
        testID={`route-library-row-${route.legacyRoute.id}`}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={`Use ${route.legacyRoute.name}`}
          onPress={() => {
            planner.selectRoute(route.legacyRoute.id);
            router.back();
          }}
          style={({ pressed }) => [styles.routeHeading, pressed && { opacity: 0.68 }]}
        >
          <View style={styles.thumbnail} pointerEvents="none">
            <RouteThumbnail
              route={route.legacyRoute}
              chrome={planner.chrome}
              themeName={planner.themeName}
              focusedDistance={null}
              height={76}
            />
          </View>
          <View style={styles.routeCopy}>
            <Text numberOfLines={1} style={[TYPE.section, { color: planner.chrome.text }]}>
              {route.legacyRoute.name}
            </Text>
            <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
              {fmtDistance(route.legacyRoute.totalDistance, planner.units)}
            </Text>
            <Text numberOfLines={1} style={[TYPE.caption, { color: planner.chrome.textFaint }]}>
              {originLabel(route)}
            </Text>
          </View>
          <View style={styles.routeAccessory}>
            {selected ? (
              <View
                accessibilityLabel="Current route"
                style={[styles.current, { backgroundColor: planner.chrome.controlBg }]}
              >
                <AppIcon name="check" size={16} color={planner.chrome.accentInk} />
              </View>
            ) : (
              <AppIcon name="chevron-right" size={16} color={planner.chrome.textFaint} />
            )}
          </View>
        </Pressable>

        {!route.isDemo ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rename ${route.legacyRoute.name}`}
              testID={`route-rename-${route.legacyRoute.id}`}
              onPress={() => beginRename(route)}
              style={({ pressed }) => [
                styles.secondaryAction,
                { borderColor: planner.chrome.borderStrong, opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[TYPE.control, { color: planner.chrome.textSecondary }]}>Rename</Text>
            </Pressable>
            {route.origin === 'local' && auth.status === 'authenticated' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void saveToAccount(route)}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  { borderColor: planner.chrome.borderStrong, opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[TYPE.control, { color: planner.chrome.accentInk }]}>Save</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${route.legacyRoute.name}`}
              testID={`route-delete-${route.legacyRoute.id}`}
              onPress={() => confirmDelete(route)}
              style={({ pressed }) => [styles.deleteAction, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={[TYPE.control, { color: planner.chrome.danger }]}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <>
      <ScrollView
        testID="route-library"
        style={{ flex: 1, backgroundColor: planner.chrome.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
      >
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          Imported routes stay on this device. Sign in to keep them in sync.
        </Text>
        {message ? (
          <Text
            testID="route-library-message"
            accessibilityLiveRegion="polite"
            style={[
              styles.message,
              { color: planner.chrome.text, backgroundColor: planner.chrome.surfaceRaised },
            ]}
          >
            {message}
          </Text>
        ) : null}

        <SectionHeader
          title="YOUR ROUTES"
          detail={`${editableRoutes.length} route${editableRoutes.length === 1 ? '' : 's'}`}
          chrome={planner.chrome}
        />
        {editableRoutes.length ? (
          <Surface chrome={planner.chrome} style={styles.routeGroup}>
            {editableRoutes.map((route, index) => row(route, index === editableRoutes.length - 1))}
          </Surface>
        ) : (
          <Surface chrome={planner.chrome} style={styles.empty}>
            <View style={[styles.emptyMark, { backgroundColor: planner.chrome.controlBg }]}>
              <AppIcon name="upload" size={20} color={planner.chrome.textSecondary} />
            </View>
            <Text style={[styles.emptyCopy, TYPE.body, { color: planner.chrome.textSecondary }]}>
              Import a GPX from the Explorer route menu, or add routes from Strava.
            </Text>
          </Surface>
        )}

        <SectionHeader title="BUNDLED DEMOS" chrome={planner.chrome} />
        <Surface chrome={planner.chrome} style={styles.routeGroup}>
          {demoRoutes.map((route, index) => row(route, index === demoRoutes.length - 1))}
        </Surface>
      </ScrollView>

      <Modal
        visible={Boolean(editing)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            accessibilityViewIsModal
            style={[
              styles.renameCard,
              {
                backgroundColor: planner.chrome.surfaceRaised,
                borderColor: planner.chrome.border,
              },
            ]}
          >
            <Text style={[TYPE.section, { color: planner.chrome.text }]}>Rename route</Text>
            <TextInput
              autoFocus
              selectTextOnFocus
              maxLength={200}
              value={name}
              onChangeText={setName}
              onSubmitEditing={() => void finishRename()}
              accessibilityLabel="Route name"
              testID="route-name-input"
              style={[
                styles.input,
                {
                  color: planner.chrome.text,
                  borderColor: planner.chrome.borderStrong,
                  backgroundColor: planner.chrome.controlBg,
                },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setEditing(null)} style={styles.modalButton}>
                <Text style={[TYPE.control, { color: planner.chrome.textSecondary }]}>Cancel</Text>
              </Pressable>
              <View style={styles.modalSave}>
                <ActionButton
                  label={busy ? 'Saving…' : 'Save name'}
                  chrome={planner.chrome}
                  onPress={() => void finishRename()}
                  testID="route-name-save"
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: SP[4],
    gap: SP[5],
  },
  message: { padding: SP[3], borderRadius: RADIUS.md, overflow: 'hidden' },
  routeGroup: { padding: 0, overflow: 'hidden' },
  routeRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  routeRowLast: { borderBottomWidth: 0 },
  routeHeading: {
    minHeight: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    padding: SP[3],
  },
  thumbnail: { width: 96, flexShrink: 0 },
  routeCopy: { flex: 1, minWidth: 0, gap: SP[1] },
  routeAccessory: {
    width: 32,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  current: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP[2],
    paddingLeft: 120,
    paddingRight: SP[3],
    paddingBottom: SP[3],
  },
  secondaryAction: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: SP[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.full,
  },
  deleteAction: { minHeight: 40, justifyContent: 'center', paddingHorizontal: SP[3] },
  empty: { flexDirection: 'row', alignItems: 'center', gap: SP[3] },
  emptyCopy: { flex: 1, minWidth: 0 },
  emptyMark: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: SP[5],
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  renameCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.xl,
    padding: SP[4],
    gap: SP[4],
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP[3],
    ...TYPE.body,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: SP[3],
  },
  modalButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SP[2] },
  modalSave: { minWidth: 124 },
});
