import * as AppleAuthentication from 'expo-apple-authentication';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { ActionButton, SectionHeader, Surface } from '../src/design/Primitives';
import { notificationReadinessPresentation } from '../src/notifications/readiness';
import { usePlanner } from '../src/state';
import { RADIUS, SP, TYPE } from '../src/theme';

function SettingRow({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const { chrome } = usePlanner();
  return (
    <View style={[styles.row, { borderColor: chrome.border }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[TYPE.control, { color: chrome.text }]}>{title}</Text>
        <Text style={[TYPE.support, { color: chrome.textSecondary }]}>{detail}</Text>
      </View>
      {action}
    </View>
  );
}

function StravaButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.stravaButton, pressed && { opacity: 0.78 }]}
    >
      <Text style={styles.stravaButtonText}>{label}</Text>
    </Pressable>
  );
}

function identityDescription(providers: Array<'strava' | 'apple'>): string {
  if (providers.includes('strava') && providers.includes('apple')) {
    return 'Signed in with Strava and Apple';
  }
  if (providers.includes('strava')) return 'Signed in with Strava';
  if (providers.includes('apple')) return 'Signed in with Apple';
  return 'Signed in';
}

export default function AccountScreen() {
  const auth = useAuth();
  const planner = usePlanner();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { strava, watchRoute, watchGeometry } = useLocalSearchParams<{
    strava?: string;
    watchRoute?: string;
    watchGeometry?: string;
  }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const visibleMessage =
    message ??
    (strava === 'denied' ? 'Strava authentication was canceled. Nothing was changed.' : null);

  async function run(label: string, work: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const preferenceSeed = {
    units: planner.units,
    temperatureUnit: planner.temperatureUnit,
    theme: planner.themePreference,
    defaultSpeed: planner.speed,
    acceptableStartMinutes: planner.acceptableStartMinutes,
    acceptableEndMinutes: planner.acceptableEndMinutes,
    weeklyStartSchedule: planner.weeklyStartSchedule,
  } as const;
  const signedIn = auth.status === 'authenticated' && auth.session;
  const hasApple = auth.authProviders.includes('apple');
  const notificationStatus = notificationReadinessPresentation(auth.notificationReadiness);

  const notificationAction =
    notificationStatus.remediation === 'enable'
      ? {
          label: 'Set up',
          run: () => auth.enableNotifications(),
        }
      : notificationStatus.remediation === 'open-settings'
        ? {
            label: 'Settings',
            run: () => Linking.openSettings(),
          }
        : notificationStatus.remediation === 'retry'
          ? {
              label: 'Retry',
              run: () => auth.refreshNotificationReadiness(),
            }
          : notificationStatus.remediation === 'manage-watches'
            ? {
                label: 'Add watch',
                run: async () => router.push('/watches'),
              }
            : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: planner.chrome.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
    >
      <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
        Guest planning always stays available. Routes are uploaded only when you choose Save to
        account.
      </Text>

      {visibleMessage ? (
        <Text
          accessibilityRole="alert"
          style={[
            styles.message,
            { color: planner.chrome.danger, backgroundColor: planner.chrome.surfaceRaised },
          ]}
        >
          {visibleMessage}
        </Text>
      ) : null}

      <SectionHeader
        title="Runcast account"
        detail={signedIn ? identityDescription(auth.authProviders) : 'Guest mode'}
        chrome={planner.chrome}
      />
      <Surface chrome={planner.chrome} style={styles.surface}>
        {!signedIn ? (
          <>
            <Text style={[TYPE.section, { color: planner.chrome.text }]}>Sign in to Runcast</Text>
            <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
              Import Strava routes and keep saved routes, watches, and preferences across devices.
            </Text>
            <StravaButton
              label={busy === 'strava-signin' ? 'Opening Strava…' : 'Connect with Strava'}
              onPress={() =>
                void run('strava-signin', async () => {
                  await auth.signInWithStrava(preferenceSeed);
                  router.replace(
                    watchRoute && watchGeometry
                      ? `/watches?pendingRouteId=${encodeURIComponent(watchRoute)}&routeGeometry=${encodeURIComponent(watchGeometry)}`
                      : '/strava-routes',
                  );
                })
              }
            />
            <View style={styles.orRow} accessibilityElementsHidden>
              <View style={[styles.orLine, { backgroundColor: planner.chrome.border }]} />
              <Text style={[TYPE.caption, { color: planner.chrome.textFaint }]}>or</Text>
              <View style={[styles.orLine, { backgroundColor: planner.chrome.border }]} />
            </View>
            {auth.appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  planner.themeName === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={RADIUS.md}
                style={styles.appleButtonSecondary}
                onPress={() =>
                  void run('apple-signin', async () => {
                    await auth.signInWithApple(preferenceSeed);
                    if (watchRoute && watchGeometry) {
                      router.replace(
                        `/watches?pendingRouteId=${encodeURIComponent(watchRoute)}&routeGeometry=${encodeURIComponent(watchGeometry)}`,
                      );
                    }
                  })
                }
              />
            ) : (
              <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
                Sign in with Apple is available in the iOS app.
              </Text>
            )}
          </>
        ) : (
          <>
            <SettingRow
              title={auth.session?.user.displayName ?? 'Runcast runner'}
              detail={
                auth.syncStatus === 'syncing'
                  ? 'Syncing…'
                  : auth.syncStatus === 'offline'
                    ? 'Offline · changes will retry'
                    : identityDescription(auth.authProviders)
              }
              action={
                <ActionButton
                  label="Sync"
                  chrome={planner.chrome}
                  onPress={() => void run('sync', auth.syncNow)}
                  variant="secondary"
                />
              }
            />
            {auth.conflicts > 0 ? (
              <Text style={[TYPE.support, { color: planner.chrome.danger }]}>
                {auth.conflicts} offline edit needs to be reapplied to the current server version.
              </Text>
            ) : null}
            <ActionButton
              label={busy === 'save' ? 'Saving…' : 'Save current route to account'}
              chrome={planner.chrome}
              onPress={() =>
                void run('save', async () => {
                  const result = await auth.saveRoute(
                    planner.selected.legacyRoute,
                    planner.selected.legacyCoverage,
                    planner.selected.originalGpx ?? undefined,
                  );
                  setMessage(
                    result === 'queued'
                      ? 'Offline: route save queued for the next sync.'
                      : 'Route saved to your account.',
                  );
                })
              }
            />
          </>
        )}
      </Surface>

      {signedIn ? (
        <>
          <SectionHeader title="Sign-in methods & services" chrome={planner.chrome} />
          <Surface chrome={planner.chrome} style={styles.surface}>
            <SettingRow
              title="Route watches"
              detail="Recurring weekday windows and optional push reminders"
              action={
                <ActionButton
                  label="Manage"
                  chrome={planner.chrome}
                  onPress={() => router.push('/watches')}
                  variant="secondary"
                />
              }
            />
            {auth.stravaConnected ? (
              <SettingRow
                title="Strava"
                detail="Linked for sign-in and route import"
                action={
                  <ActionButton
                    label="Browse routes"
                    chrome={planner.chrome}
                    onPress={() => router.push('/strava-routes')}
                    variant="secondary"
                  />
                }
              />
            ) : (
              <>
                <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
                  Link Strava to this Runcast account and browse your running routes.
                </Text>
                <StravaButton
                  label={busy === 'strava-link' ? 'Opening Strava…' : 'Connect with Strava'}
                  onPress={() =>
                    void run('strava-link', async () => {
                      await auth.connectStrava();
                      router.push('/strava-routes');
                    })
                  }
                />
              </>
            )}
            {!hasApple && auth.appleAvailable ? (
              <>
                <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
                  Add Apple as another way to sign in to this same account.
                </Text>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={
                    planner.themeName === 'dark'
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={RADIUS.md}
                  style={styles.appleButtonSecondary}
                  onPress={() => void run('apple-link', auth.linkApple)}
                />
              </>
            ) : null}
            <SettingRow
              title={notificationStatus.title}
              detail={notificationStatus.detail}
              action={
                notificationAction ? (
                  <ActionButton
                    label={busy === 'notifications' ? 'Working…' : notificationAction.label}
                    chrome={planner.chrome}
                    onPress={() => void run('notifications', notificationAction.run)}
                    variant="secondary"
                  />
                ) : undefined
              }
            />
          </Surface>

          <SectionHeader title="Account control" chrome={planner.chrome} />
          <Surface chrome={planner.chrome} style={styles.surface}>
            <ActionButton
              label="Sign out"
              chrome={planner.chrome}
              onPress={() => void run('signout', () => auth.signOut())}
              variant="secondary"
            />
            <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
              Signing out keeps your Runcast account, saved data, and linked providers.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(
                  'Delete Runcast account?',
                  'This attempts to revoke Apple and Strava access and permanently deletes saved routes, watches, notifications, and local account caches.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete account',
                      style: 'destructive',
                      onPress: () => void run('delete', auth.deleteAccount),
                    },
                  ],
                )
              }
              style={({ pressed }) => [
                styles.delete,
                { borderColor: planner.chrome.danger, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[TYPE.control, { color: planner.chrome.danger }]}>Delete account</Text>
            </Pressable>
          </Surface>
        </>
      ) : null}

      <Text style={[TYPE.caption, { color: planner.chrome.textFaint, textAlign: 'center' }]}>
        Forecasts are advisory, not a guarantee of safe running conditions.
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
    gap: SP[5],
  },
  surface: { gap: SP[3] },
  stravaButton: {
    width: '100%',
    minHeight: 48,
    paddingHorizontal: SP[4],
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FC4C02',
  },
  stravaButtonText: { ...TYPE.control, color: '#FFFFFF' },
  appleButtonSecondary: { width: '78%', maxWidth: 280, height: 44, alignSelf: 'center' },
  orRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: SP[3] },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: SP[3],
  },
  message: { padding: SP[3], borderRadius: RADIUS.md, overflow: 'hidden' },
  delete: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
