import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDistance } from '@runcast/core';
import { AlertBanner } from '../src/cards/AlertBanner';
import { RunBriefDock } from '../src/cards/RunBriefDock';
import { useAuth } from '../src/auth/AuthProvider';
import { PaceEditorModal, RoutePicker } from '../src/controls/Controls';
import { HeaderActions } from '../src/controls/HeaderActions';
import { StartTimePickerSheet } from '../src/controls/StartTimePickerSheet';
import { useIntroduction } from '../src/introduction/IntroductionProvider';
import {
  IntroductionInvitation,
  IntroductionSpotlightOverlay,
} from '../src/introduction/IntroductionScreen';
import { RunMap } from '../src/map/RunMap';
import { usePlanner } from '../src/state';
import { RADIUS, SHADOW, SP, TYPE } from '../src/theme';

export default function ExplorerRoute() {
  const introductionState = useIntroduction();
  const { chrome } = usePlanner();
  const { introduction } = useLocalSearchParams<{ introduction?: string | string[] }>();
  const beganIntroduction = useRef(false);
  const replay = Array.isArray(introduction)
    ? introduction.includes('replay')
    : introduction === 'replay';

  useEffect(() => {
    if (!introductionState.ready || beganIntroduction.current) return;
    const mode = replay ? 'replay' : introductionState.completed ? null : 'first-run';
    if (!mode) return;
    beganIntroduction.current = true;
    introductionState.begin(mode);
  }, [introductionState, replay]);

  if (!introductionState.ready) return <View style={{ flex: 1, backgroundColor: chrome.bg }} />;
  return <ExplorerScreen />;
}

function ExplorerScreen() {
  const planner = usePlanner();
  const introduction = useIntroduction();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const [paceOpen, setPaceOpen] = useState(false);
  const [startTimeOpen, setStartTimeOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const previousStartTime = useRef(planner.startTime);
  const accessibleText = fontScale >= 1.3;
  const expectedDockHeight = accessibleText ? Math.min(height * 0.58, 510) : 380;
  const [dockHeight, setDockHeight] = useState(expectedDockHeight);
  const [alertHeight, setAlertHeight] = useState(0);
  const dockBottom = insets.bottom + SP[3];
  const fixedDockHeight = Math.min(expectedDockHeight, height - insets.top - dockBottom - 90);
  const mapInset = dockBottom + dockHeight + (alertHeight > 0 ? alertHeight + SP[2] : 0);
  const { chrome, themeName } = planner;
  const setRunCardRef = useCallback(
    (node: View | null) => introduction.registerTarget('run-card', node),
    [introduction.registerTarget],
  );

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const startChanged = previousStartTime.current !== planner.startTime;
    previousStartTime.current = planner.startTime;
    if (reduceMotion) {
      contentOpacity.stopAnimation();
      contentOpacity.setValue(1);
      return;
    }
    if (!startChanged) return;
    contentOpacity.setValue(0.38);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [contentOpacity, planner.startTime, reduceMotion]);

  const routeMeta = fmtDistance(planner.activeLegacyRoute.totalDistance, planner.units);

  return (
    <View testID="explorer-screen" style={{ flex: 1, backgroundColor: chrome.bg }}>
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      <RunMap
        route={planner.activeLegacyRoute}
        profile={planner.routeConditionsProfile}
        themeName={themeName}
        chrome={chrome}
        units={planner.units}
        bottomInset={mapInset}
        shadeHighlight={planner.shadeHighlight}
        showFocusMarker={false}
        routePressEnabled={false}
      />

      <View style={[styles.floatingHeader, { top: insets.top + SP[2] }]} pointerEvents="box-none">
        <View style={styles.headerRow} pointerEvents="box-none">
          <View style={styles.routePickerSlot}>
            <RoutePicker
              planner={planner}
              stravaConnected={auth.stravaConnected}
              mapOverlay
              onStrava={() =>
                auth.status === 'authenticated' && auth.stravaConnected
                  ? router.push('/strava-routes')
                  : router.push('/account')
              }
              onManage={() => router.push('/route-library')}
            />
          </View>
          <View style={styles.headerActions}>
            <HeaderActions
              planner={planner}
              authStatus={auth.status}
              displayName={auth.session?.user.displayName}
              syncStatus={auth.syncStatus}
              stravaConnected={auth.stravaConnected}
              authProviders={auth.authProviders}
              mapOverlay
              onSettings={() => router.push('/settings')}
              onAccount={() => router.push('/account')}
              onHelp={() => router.push('/help')}
            />
          </View>
        </View>
        {planner.importError ? (
          <Text
            style={[styles.importError, { color: chrome.danger, backgroundColor: chrome.cockpit }]}
            accessibilityRole="alert"
          >
            {planner.importError}
          </Text>
        ) : null}
      </View>

      <View
        style={[styles.alertWrap, { bottom: dockBottom + dockHeight + SP[2] }]}
        onLayout={(event) => setAlertHeight(event.nativeEvent.layout.height)}
      >
        <AlertBanner planner={planner} variant="compact" />
      </View>

      <View
        ref={setRunCardRef}
        collapsable={false}
        style={[
          styles.dock,
          {
            bottom: dockBottom,
            height: fixedDockHeight,
            backgroundColor: chrome.cockpit,
            borderColor: chrome.cockpitBorder,
            shadowOpacity: themeName === 'dark' ? 0.32 : 0.16,
          },
        ]}
        onLayout={(event) => {
          setDockHeight(event.nativeEvent.layout.height);
          introduction.targetDidLayout();
        }}
      >
        <RunBriefDock
          planner={planner}
          routeMeta={routeMeta}
          maxContentHeight={Math.max(100, fixedDockHeight - 44)}
          accessibleText={accessibleText}
          contentOpacity={contentOpacity}
          onEditStart={() => setStartTimeOpen(true)}
          onEditPace={() => setPaceOpen(true)}
          onOpenPlan={(startTime) => {
            planner.setStartTime(startTime);
            router.push('/planner');
          }}
        />
      </View>

      <PaceEditorModal planner={planner} visible={paceOpen} onClose={() => setPaceOpen(false)} />
      <StartTimePickerSheet
        planner={planner}
        visible={startTimeOpen}
        onClose={() => {
          planner.previewStartTime(null);
          setStartTimeOpen(false);
        }}
      />

      {introduction.flow?.step === 'invite' && planner.routeConditionsProfile ? (
        <View style={[styles.invitationWrap, { bottom: dockBottom + dockHeight + SP[2] }]}>
          <IntroductionInvitation onShow={() => introduction.advance()} />
        </View>
      ) : null}
      <IntroductionSpotlightOverlay surface="explorer" />
    </View>
  );
}

const styles = StyleSheet.create({
  invitationWrap: {
    position: 'absolute',
    left: SP[4],
    right: SP[4],
    zIndex: 20,
  },
  floatingHeader: { position: 'absolute', left: 0, right: 0, zIndex: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingRight: SP[4] },
  routePickerSlot: { flex: 1, minWidth: 0 },
  headerActions: { flexShrink: 0, marginLeft: SP[2] },
  importError: {
    marginTop: SP[2],
    marginHorizontal: SP[4],
    paddingHorizontal: SP[3],
    paddingVertical: SP[2],
    borderRadius: RADIUS.md,
    ...TYPE.support,
    overflow: 'hidden',
  },
  alertWrap: { position: 'absolute', left: SP[4], right: SP[4], zIndex: 11 },
  dock: {
    position: 'absolute',
    left: SP[3],
    right: SP[3],
    zIndex: 12,
    borderRadius: RADIUS.dock,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SP[4],
    gap: SP[3],
    shadowColor: SHADOW.color,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
});
