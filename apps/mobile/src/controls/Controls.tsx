/**
 * Input controls: pace stepper, route picker with GPX and linked route
 * sources, and the flyover play button. Planner time selection lives in
 * DayRunOutlook.tsx.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDistance, fmtPace, hoverBus, paceToSpeed, speedToPaceSeconds } from '@runcast/core';
import type { Planner } from '../state';
import { planningPlaybackTimeline } from '../data/planningPresentation';
import { playbackDistanceAtTime } from '@runcast/core';
import { AppIcon } from '../design/Icon';
import { ActionButton, IconButton } from '../design/Primitives';
import { useIntroduction } from '../introduction/IntroductionProvider';
import { CONTROL, FAMILY, RADIUS, SHADOW, SP, TYPE } from '../theme';
import {
  MAX_PACE_SECONDS,
  MIN_PACE_SECONDS,
  PACE_COMMIT_DELAY_MS,
  PACE_STEP_SECONDS,
  nudgePaceSeconds,
} from './paceStepperModel';
import { E2E_BUILD_ENABLED, E2E_GPX, E2E_GPX_FILENAME } from '../e2e/runtime';
import { routeMenuLayout } from './routeMenuLayout';

export function RoutePicker({
  planner,
  stravaConnected,
  onStrava,
  onManage,
  mapOverlay = false,
}: {
  planner: Planner;
  stravaConnected: boolean;
  onStrava: () => void;
  onManage: () => void;
  mapOverlay?: boolean;
}) {
  const { chrome } = planner;
  const buttonBackground = mapOverlay ? chrome.surface : chrome.surfaceRaised;
  const buttonBorder = chrome.borderStrong;
  const buttonText = mapOverlay ? chrome.textSecondary : chrome.text;
  const buttonIcon = mapOverlay ? chrome.textFaint : chrome.textSecondary;
  const { registerTarget, targetDidLayout } = useIntroduction();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const buttonRef = useRef<View>(null);
  const pickingGpxRef = useRef(false);
  const pendingGpxRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [pickingGpx, setPickingGpx] = useState(false);
  const setButtonRef = useCallback(
    (node: View | null) => {
      buttonRef.current = node;
      registerTarget('route-picker', node);
    },
    [registerTarget],
  );
  const [anchor, setAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>({
    x: SP[4],
    y: 0,
    width: 0,
    height: CONTROL.height,
  });

  const menuLayout = routeMenuLayout({
    anchor,
    windowWidth,
    windowHeight,
    bottomInset: insets.bottom,
  });

  function showMenu(): void {
    if (pickingGpxRef.current) return;
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  }

  async function pickGpx(): Promise<void> {
    if (pickingGpxRef.current) return;
    pickingGpxRef.current = true;
    setPickingGpx(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/gpx+xml', 'application/octet-stream', 'text/xml', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      let xml: string;
      try {
        xml = await FileSystem.readAsStringAsync(asset.uri);
      } catch {
        await planner.importGpx('', asset.name ?? 'Imported route').catch(() => {});
        return;
      }
      const imported = await planner
        .importGpx(xml, asset.name ?? 'Imported route')
        .catch(() => null);
      if (imported?.status === 'duplicate') {
        Alert.alert('Route already added', `${imported.name} is already in your Route Library.`);
      }
    } catch (error) {
      console.warn('GPX document picker failed', error);
      const pickerWasAlreadyOpen =
        error instanceof Error && error.message.includes('PickingInProgressException');
      Alert.alert(
        "Couldn't open Files",
        pickerWasAlreadyOpen
          ? 'A previous Files picker is still open or was interrupted. Reload Runcast and try again.'
          : 'Please wait a moment and try importing the GPX again.',
      );
    } finally {
      pickingGpxRef.current = false;
      setPickingGpx(false);
    }
  }

  function requestGpxImport(): void {
    if (pickingGpxRef.current || pendingGpxRef.current) return;
    pendingGpxRef.current = true;
    setOpen(false);
  }

  function openPendingGpxImport(): void {
    if (!pendingGpxRef.current) return;
    pendingGpxRef.current = false;
    void pickGpx();
  }

  async function importE2eFixture(): Promise<void> {
    setOpen(false);
    const imported = await planner.importGpx(E2E_GPX, E2E_GPX_FILENAME).catch(() => null);
    if (imported?.status === 'duplicate') {
      Alert.alert('Route already added', `${imported.name} is already in your Route Library.`);
    }
  }

  return (
    <View style={styles.routePickerRoot}>
      <Pressable
        ref={setButtonRef}
        disabled={pickingGpx}
        onPress={showMenu}
        accessibilityRole="button"
        accessibilityLabel={`Select route, ${planner.selected.legacyRoute.name}`}
        accessibilityState={{ expanded: open, disabled: pickingGpx }}
        testID="route-picker"
        onLayout={targetDidLayout}
        style={({ pressed }) => [
          styles.routePickerButton,
          mapOverlay && styles.routePickerButtonMap,
          {
            backgroundColor: buttonBackground,
            borderColor: buttonBorder,
            shadowOpacity: mapOverlay ? 0.07 : SHADOW.opacity,
            opacity: pressed ? 0.74 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.5}
          style={[
            styles.routePickerLabel,
            mapOverlay && styles.routePickerLabelMap,
            { color: buttonText },
          ]}
        >
          {planner.selected.legacyRoute.name}
        </Text>
        <AppIcon
          name="chevron-down"
          color={buttonIcon}
          size={14}
          backgroundColor={buttonBackground}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setOpen(false)}
        onDismiss={openPendingGpxImport}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, styles.routeMenuBackdrop]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close route menu"
        />
        <View
          accessibilityViewIsModal
          accessibilityRole="menu"
          style={[
            styles.routeMenu,
            {
              top: menuLayout.top,
              left: menuLayout.left,
              width: menuLayout.width,
              maxHeight: menuLayout.maxHeight,
              backgroundColor: chrome.surfaceRaised,
              borderColor: chrome.border,
            },
          ]}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={styles.routeMenuScroll}
            contentContainerStyle={styles.routeMenuContent}
          >
            <Text style={[styles.routeMenuTitle, { color: chrome.textFaint }]}>ROUTES</Text>
            {planner.routes.map((entry) => {
              const selected = entry.legacyRoute.id === planner.selected.legacyRoute.id;
              return (
                <Pressable
                  key={entry.legacyRoute.id}
                  onPress={() => {
                    setOpen(false);
                    planner.selectRoute(entry.legacyRoute.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.legacyRoute.name}, ${fmtDistance(entry.legacyRoute.totalDistance, planner.units)}`}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.routeMenuRow,
                    pressed && { backgroundColor: chrome.controlBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.routeMenuCheck,
                      { color: selected ? chrome.accentInk : 'transparent' },
                    ]}
                  >
                    ✓
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.routeMenuName,
                      selected && styles.routeMenuNameSelected,
                      { color: selected ? chrome.text : chrome.textSecondary },
                    ]}
                  >
                    {entry.legacyRoute.name}
                  </Text>
                  <Text style={[styles.routeMenuDistance, { color: chrome.textFaint }]}>
                    {fmtDistance(entry.legacyRoute.totalDistance, planner.units)}
                  </Text>
                </Pressable>
              );
            })}
            <View style={[styles.routeMenuDivider, { backgroundColor: chrome.border }]} />
            <Text style={[styles.routeMenuTitle, { color: chrome.textFaint }]}>ADD A ROUTE</Text>
            {E2E_BUILD_ENABLED ? (
              <Pressable
                onPress={() => void importE2eFixture()}
                accessibilityRole="button"
                accessibilityLabel="Load deterministic E2E route"
                testID="e2e-import-route"
                style={({ pressed }) => [styles.routeMenuRow, pressed && { opacity: 0.68 }]}
              >
                <View style={styles.routeMenuCheck}>
                  <AppIcon name="plus" color={chrome.accentInk} size={16} />
                </View>
                <Text style={[styles.routeMenuName, { color: chrome.accentInk }]}>E2E route</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={pickingGpx}
              onPress={requestGpxImport}
              accessibilityRole="button"
              accessibilityLabel="Import GPX route"
              accessibilityState={{ disabled: pickingGpx }}
              style={({ pressed }) => [
                styles.routeMenuRow,
                (pressed || pickingGpx) && { opacity: 0.68 },
              ]}
            >
              <View style={styles.routeMenuCheck}>
                <AppIcon name="plus" color={chrome.accentInk} size={16} />
              </View>
              <Text style={[styles.routeMenuName, { color: chrome.accentInk }]}>
                {pickingGpx ? 'Opening…' : 'Import GPX'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setOpen(false);
                onStrava();
              }}
              accessibilityRole="button"
              accessibilityLabel={stravaConnected ? 'Import from Strava' : 'Connect Strava'}
              style={({ pressed }) => [styles.routeMenuRow, pressed && { opacity: 0.68 }]}
            >
              <View style={styles.routeMenuCheck}>
                <AppIcon name="link" color={chrome.accentInk} size={17} />
              </View>
              <Text style={[styles.routeMenuName, { color: chrome.accentInk }]}>
                {stravaConnected ? 'Import from Strava' : 'Connect Strava'}
              </Text>
            </Pressable>
            <View style={[styles.routeMenuDivider, { backgroundColor: chrome.border }]} />
            <Pressable
              onPress={() => {
                setOpen(false);
                onManage();
              }}
              accessibilityRole="button"
              accessibilityLabel="Manage Route Library"
              testID="manage-route-library"
              style={({ pressed }) => [styles.routeMenuRow, pressed && { opacity: 0.68 }]}
            >
              <View style={styles.routeMenuCheck}>
                <AppIcon name="more" color={chrome.accentInk} size={17} />
              </View>
              <Text style={[styles.routeMenuName, { color: chrome.accentInk }]}>Manage routes</Text>
              <AppIcon name="chevron-right" color={chrome.textFaint} size={13} />
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

export function PaceStepper({
  planner,
  showHeading = true,
}: {
  planner: Planner;
  showHeading?: boolean;
}) {
  const { chrome, speed, setSpeed, units } = planner;
  const plannerPaceSec =
    Math.round(speedToPaceSeconds(speed, units) / PACE_STEP_SECONDS) * PACE_STEP_SECONDS;
  const [paceSec, setPaceSec] = useState(plannerPaceSec);
  const paceSecRef = useRef(plannerPaceSec);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitUnitsRef = useRef(units);
  const setSpeedRef = useRef(setSpeed);
  setSpeedRef.current = setSpeed;

  useEffect(() => {
    if (commitTimerRef.current !== null) return;
    paceSecRef.current = plannerPaceSec;
    setPaceSec(plannerPaceSec);
  }, [plannerPaceSec]);

  useEffect(
    () => () => {
      if (commitTimerRef.current === null) return;
      clearTimeout(commitTimerRef.current);
      setSpeedRef.current(paceToSpeed(paceSecRef.current, commitUnitsRef.current));
    },
    [],
  );

  const scheduleCommit = () => {
    if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
    commitUnitsRef.current = units;
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      setSpeedRef.current(paceToSpeed(paceSecRef.current, commitUnitsRef.current));
    }, PACE_COMMIT_DELAY_MS);
  };

  const nudge = (deltaSec: number) => {
    const current = paceSecRef.current;
    const next = nudgePaceSeconds(current, deltaSec);
    if (next === current) return;
    paceSecRef.current = next;
    setPaceSec(next);
    void Haptics.selectionAsync().catch(() => {});
    scheduleCommit();
  };
  return (
    <View>
      {showHeading ? (
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: chrome.textFaint }]}>EXPECTED FLAT PACE</Text>
          <Text style={[TYPE.caption, { color: chrome.textFaint }]}>
            flat · grade-adjusted on hills
          </Text>
        </View>
      ) : null}
      <View style={styles.paceRow}>
        <IconButton
          name="minus"
          label="Lower pace by 5 seconds"
          chrome={chrome}
          disabled={paceSec <= MIN_PACE_SECONDS}
          onPress={() => nudge(-PACE_STEP_SECONDS)}
        />
        <Text
          accessibilityLiveRegion="polite"
          style={[TYPE.data, { color: chrome.text, minWidth: 108, textAlign: 'center' }]}
        >
          {fmtPace(paceToSpeed(paceSec, units), units)}
        </Text>
        <IconButton
          name="plus"
          label="Raise pace by 5 seconds"
          chrome={chrome}
          disabled={paceSec >= MAX_PACE_SECONDS}
          onPress={() => nudge(PACE_STEP_SECONDS)}
        />
      </View>
    </View>
  );
}

export function PaceEditorModal({
  planner,
  visible,
  onClose,
}: {
  planner: Planner;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { chrome } = planner;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.paceModalRoot}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.paceBackdrop]}
          onPress={onClose}
          accessibilityLabel="Close pace editor"
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.paceSheet,
            {
              paddingBottom: Math.max(insets.bottom, SP[4]),
              backgroundColor: chrome.surfaceRaised,
              borderColor: chrome.borderStrong,
            },
          ]}
        >
          <View style={styles.paceSheetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[TYPE.section, { color: chrome.text }]}>Expected flat pace</Text>
              <Text style={[TYPE.support, { color: chrome.textSecondary }]}>
                Flat-ground pace; hills adjust your estimated timing automatically.
              </Text>
            </View>
            <IconButton name="close" label="Close pace editor" chrome={chrome} onPress={onClose} />
          </View>
          <PaceStepper planner={planner} showHeading={false} />
          <View style={{ alignItems: 'flex-end' }}>
            <ActionButton label="Done" chrome={chrome} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Flyover play/pause — identical logic to the web PlayButton. */
export function PlayButton({ planner }: { planner: Planner }) {
  const { chrome } = planner;
  const timeline = useMemo(
    () => planningPlaybackTimeline(planner.routeConditionsProfile),
    [planner.routeConditionsProfile],
  );
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const runElapsed = useRef(0);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const playingRef = useRef(false);
  playingRef.current = playing;

  function stop(clear: boolean): void {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    if (clear) {
      runElapsed.current = 0;
      hoverBus.publish({ distance: null, source: 'play' });
    }
  }

  function play(): void {
    const currentTimeline = timelineRef.current;
    if (!currentTimeline) return;
    const duration = currentTimeline.durationMs;
    if (duration <= 0) return;
    const wall = Math.min(Math.max(duration / 120, 15_000), 40_000);
    const speedup = duration / wall;
    if (runElapsed.current >= duration) runElapsed.current = 0;

    setPlaying(true);
    let last = performance.now();
    const tick = (now: number) => {
      const current = timelineRef.current;
      if (!current) return stop(true);
      runElapsed.current += (now - last) * speedup;
      last = now;
      const time = current.startTime + runElapsed.current;
      hoverBus.publish({
        distance: playbackDistanceAtTime(current.samples, time),
        source: 'play',
      });
      if (runElapsed.current >= current.durationMs) {
        stop(false);
        runElapsed.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    return hoverBus.subscribe(({ distance, source }) => {
      if (playingRef.current && source !== 'play' && distance !== null) stop(false);
    });
  }, []);
  useEffect(() => {
    if (playingRef.current) stop(true);
    else runElapsed.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  if (!timeline) return null;
  return (
    <Pressable
      onPress={() => (playing ? stop(false) : play())}
      style={({ pressed }) => [
        styles.playBtn,
        {
          backgroundColor: playing ? chrome.controlActive : chrome.surfaceMuted,
          borderColor: playing ? chrome.controlActive : chrome.border,
          opacity: pressed ? 0.68 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause run preview' : 'Play run preview'}
    >
      <AppIcon
        name={playing ? 'pause' : 'play'}
        color={playing ? chrome.controlActiveText : chrome.textSecondary}
        size={18}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  routePickerRoot: {
    alignSelf: 'stretch',
    marginLeft: SP[4],
    minWidth: 0,
  },
  routePickerButton: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: CONTROL.height,
    paddingLeft: SP[4],
    paddingRight: SP[3],
    borderRadius: RADIUS.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
    shadowColor: SHADOW.color,
    shadowOpacity: SHADOW.opacity,
    shadowRadius: SHADOW.radius,
    shadowOffset: SHADOW.offset,
  },
  routePickerButtonMap: {
    height: CONTROL.compactHeight,
    paddingLeft: SP[3],
    paddingRight: SP[2],
  },
  routePickerLabel: {
    flexShrink: 1,
    fontFamily: FAMILY.displayMedium,
    fontSize: 15,
    lineHeight: 20,
  },
  routePickerLabelMap: { fontSize: 14, lineHeight: 19 },
  routeMenu: {
    position: 'absolute',
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: SHADOW.color,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  routeMenuBackdrop: { backgroundColor: 'rgba(0, 0, 0, 0.54)' },
  routeMenuScroll: { flexShrink: 1, borderRadius: RADIUS.xl },
  routeMenuContent: { padding: SP[2] },
  routeMenuTitle: {
    paddingHorizontal: SP[3],
    paddingTop: SP[2],
    paddingBottom: SP[1],
    ...TYPE.label,
  },
  routeMenuRow: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  routeMenuCheck: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
    ...TYPE.support,
    fontWeight: '800',
  },
  routeMenuName: { ...TYPE.control, flex: 1, minWidth: 0 },
  routeMenuNameSelected: { fontWeight: '700' },
  routeMenuDistance: { ...TYPE.support, fontVariant: ['tabular-nums'] },
  routeMenuDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: SP[3],
    marginVertical: SP[1],
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: SP[1],
  },
  label: TYPE.label,
  paceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[4],
    paddingVertical: SP[2],
  },
  paceModalRoot: { flex: 1, justifyContent: 'flex-end' },
  paceBackdrop: { backgroundColor: 'rgba(0, 0, 0, 0.42)' },
  paceSheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP[4],
    paddingTop: SP[4],
    gap: SP[4],
    shadowColor: SHADOW.color,
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },
  paceSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: SP[3] },
  playBtn: {
    width: CONTROL.height,
    height: CONTROL.height,
    borderRadius: RADIUS.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
