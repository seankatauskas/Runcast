import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuthStatus, SyncStatus } from '../auth/AuthProvider';
import type { AuthProvider } from '@runcast/contracts';
import { AppIcon } from '../design/Icon';
import { IconButton } from '../design/Primitives';
import type { Planner } from '../state';
import { CONTROL, RADIUS, SHADOW, SP, TYPE } from '../theme';

interface Props {
  planner: Planner;
  authStatus: AuthStatus;
  displayName?: string | null;
  syncStatus: SyncStatus;
  stravaConnected: boolean;
  authProviders: AuthProvider[];
  onSettings: () => void;
  onAccount: () => void;
  onHelp: () => void;
  mapOverlay?: boolean;
}

interface MenuRowProps {
  title: string;
  detail?: string;
  onPress: () => void;
  chrome: Planner['chrome'];
}

function MenuRow({ title, detail, onPress, chrome }: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.68 }]}
    >
      <View style={styles.menuCopy}>
        <Text style={[TYPE.control, { color: chrome.text }]}>{title}</Text>
        {detail ? (
          <Text style={[TYPE.support, { color: chrome.textSecondary }]}>{detail}</Text>
        ) : null}
      </View>
      <AppIcon name="chevron-right" color={chrome.textFaint} size={16} />
    </Pressable>
  );
}

export function HeaderActions({
  planner,
  authStatus,
  displayName,
  syncStatus,
  stravaConnected,
  authProviders,
  onSettings,
  onAccount,
  onHelp,
  mapOverlay = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const moreAnchor = useRef<View>(null);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: CONTROL.height,
    height: CONTROL.height,
  });
  const [directionMessage, setDirectionMessage] = useState<string | null>(null);
  const controlChrome: Planner['chrome'] = mapOverlay
    ? {
        ...planner.chrome,
        surfaceRaised: planner.chrome.cockpit,
        borderStrong: planner.chrome.cockpitBorder,
        textSecondary: planner.chrome.cockpitTextSecondary,
        controlActive: planner.chrome.cockpitAccent,
        controlActiveText: planner.chrome.cockpitAccentText,
      }
    : planner.chrome;
  const menuWidth = Math.min(320, windowWidth - SP[4] * 2);
  const menuLeft = Math.max(
    SP[4],
    Math.min(anchor.x + anchor.width - menuWidth, windowWidth - menuWidth - SP[4]),
  );
  const menuTop = anchor.y + anchor.height + SP[2];
  const menuMaxHeight = Math.max(120, windowHeight - menuTop - insets.bottom - SP[4]);

  useEffect(
    () => () => {
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    },
    [],
  );

  function toggleMenu(): void {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    moreAnchor.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setMenuOpen(true);
    });
  }

  function navigate(action: () => void): void {
    setMenuOpen(false);
    action();
  }

  function reverseDirection(): void {
    const message = planner.reversed ? 'Original direction restored' : 'Direction reversed';
    planner.toggleReverse();
    setDirectionMessage(message);
    void Haptics.selectionAsync().catch(() => {});
    void AccessibilityInfo.announceForAccessibility(message);
    if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    confirmationTimer.current = setTimeout(() => setDirectionMessage(null), 1600);
  }

  const signedIn = authStatus === 'authenticated';
  const accountTitle = signedIn ? displayName?.trim() || 'Runcast runner' : 'GUEST MODE';
  const accountDetail = signedIn
    ? syncStatus === 'syncing'
      ? 'Syncing…'
      : syncStatus === 'offline'
        ? 'Offline · changes will retry'
        : 'Synced'
    : authStatus === 'hydrating'
      ? 'Loading account…'
      : 'Plan locally';

  return (
    <View style={styles.root}>
      {planner.canReverse ? (
        <IconButton
          name="reverse"
          label={planner.reversed ? 'Restore original route direction' : 'Reverse route direction'}
          chrome={controlChrome}
          onPress={reverseDirection}
          active={planner.reversed}
        />
      ) : null}
      <View ref={moreAnchor} collapsable={false}>
        <IconButton
          name="more"
          label="Open Runcast menu"
          chrome={controlChrome}
          onPress={toggleMenu}
          expanded={menuOpen}
        />
      </View>

      {directionMessage ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.confirmation,
            {
              backgroundColor: mapOverlay ? planner.chrome.cockpit : planner.chrome.surfaceRaised,
              borderColor: mapOverlay ? planner.chrome.cockpitBorder : planner.chrome.border,
            },
          ]}
        >
          <Text
            style={[
              TYPE.support,
              { color: mapOverlay ? planner.chrome.cockpitText : planner.chrome.text },
            ]}
          >
            {directionMessage}
          </Text>
        </View>
      ) : null}

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setMenuOpen(false)}
          accessibilityLabel="Close Runcast menu"
        />
        <View
          accessibilityViewIsModal
          accessibilityRole="menu"
          style={[
            styles.menu,
            {
              top: menuTop,
              left: menuLeft,
              width: menuWidth,
              maxHeight: menuMaxHeight,
              backgroundColor: planner.chrome.surfaceRaised,
              borderColor: planner.chrome.border,
            },
          ]}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={styles.menuScroll}
            contentContainerStyle={styles.menuContent}
          >
            <View style={styles.accountSummary}>
              <Text style={[TYPE.label, { color: planner.chrome.textFaint }]}>{accountTitle}</Text>
              <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
                {accountDetail}
              </Text>
            </View>

            <View style={[styles.divider, { backgroundColor: planner.chrome.border }]} />
            <MenuRow
              title="Settings"
              detail="Units, temperature, theme"
              onPress={() => navigate(onSettings)}
              chrome={planner.chrome}
            />
            <MenuRow
              title="Account & connections"
              detail={
                signedIn
                  ? authProviders.includes('strava') && authProviders.includes('apple')
                    ? 'Signed in with Strava + Apple'
                    : authProviders.includes('strava')
                      ? 'Signed in with Strava'
                      : authProviders.includes('apple')
                        ? stravaConnected
                          ? 'Signed in with Apple · Strava linked'
                          : 'Signed in with Apple'
                        : 'Signed in'
                  : authStatus === 'hydrating'
                    ? 'Loading account…'
                    : 'Strava or Apple sign-in · guest planning available'
              }
              onPress={() => navigate(onAccount)}
              chrome={planner.chrome}
            />
            <MenuRow
              title="Help & privacy"
              onPress={() => navigate(onHelp)}
              chrome={planner.chrome}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SP[2],
  },
  menu: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.xl,
    shadowColor: SHADOW.color,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  menuScroll: { flexShrink: 1, borderRadius: RADIUS.xl },
  menuContent: { padding: SP[2] },
  accountSummary: { paddingHorizontal: SP[3], paddingVertical: SP[3], gap: SP[1] },
  menuRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    paddingHorizontal: SP[3],
    paddingVertical: SP[2],
    borderRadius: RADIUS.md,
  },
  menuCopy: { flex: 1, minWidth: 0, gap: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: SP[3], marginVertical: SP[1] },
  confirmation: {
    position: 'absolute',
    top: CONTROL.height + SP[2],
    right: 0,
    minWidth: 148,
    paddingHorizontal: SP[3],
    paddingVertical: SP[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    shadowColor: SHADOW.color,
    shadowOpacity: SHADOW.opacity,
    shadowRadius: SHADOW.radius,
    shadowOffset: SHADOW.offset,
  },
});
