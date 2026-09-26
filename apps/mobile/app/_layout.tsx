import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { LogBox } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { IntroductionProvider } from '../src/introduction/IntroductionProvider';
import { AppErrorBoundary } from '../src/observability/AppErrorBoundary';
import '../src/observability/sentry';
import { NotificationLifecycle } from '../src/notifications/NotificationLifecycle';
import { PlannerProvider, usePlanner } from '../src/state';
import { normalizePlannerPreferences } from '../src/data/plannerPreferences';
import { FAMILY } from '../src/theme';
import { E2E_BUILD_ENABLED } from '../src/e2e/runtime';

// The unsigned simulator build cannot read notification keychain state. Keep that
// development-only native warning from obscuring the UI under visual review.
if (__DEV__) LogBox.ignoreLogs(['[expo-notifications] Error reading persisted']);

function AccountBridge() {
  const auth = useAuth();
  const planner = usePlanner();
  const loadedPreferencesFor = useRef<string | null>(null);
  const appliedPreferenceFingerprint = useRef<string | null>(null);
  const submittedPreferenceFingerprint = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preferencesReadyFor, setPreferencesReadyFor] = useState<string | null>(null);

  const preferenceValues = {
    units: planner.units,
    temperatureUnit: planner.temperatureUnit,
    theme: planner.themePreference,
    defaultSpeed: planner.speed,
    acceptableStartMinutes: planner.acceptableStartMinutes,
    acceptableEndMinutes: planner.acceptableEndMinutes,
    weeklyStartSchedule: planner.weeklyStartSchedule,
  } as const;
  const preferenceFingerprint = JSON.stringify(preferenceValues);

  useEffect(() => {
    planner.replaceCloudRoutes(auth.cloudRoutes, auth.session?.user.id ?? null);
  }, [auth.cloudRoutes, auth.session?.user.id, planner.replaceCloudRoutes]);

  useEffect(() => {
    const userId = auth.session?.user.id;
    if (!userId) {
      loadedPreferencesFor.current = null;
      appliedPreferenceFingerprint.current = null;
      submittedPreferenceFingerprint.current = null;
      setPreferencesReadyFor(null);
      return;
    }
    if (loadedPreferencesFor.current === userId) return;
    loadedPreferencesFor.current = userId;
    appliedPreferenceFingerprint.current = null;
    submittedPreferenceFingerprint.current = null;
    let live = true;
    void auth
      .getPreferences()
      .then((preferences) => {
        // A fresh device may be offline before it can learn the server version.
        // Do not mistake unchanged guest defaults for an intentional edit.
        if (live && !preferences) submittedPreferenceFingerprint.current = preferenceFingerprint;
      })
      .catch((error) => console.error('preference hydration failed', error))
      .finally(() => {
        if (live) setPreferencesReadyFor(userId);
      });
    return () => {
      live = false;
      loadedPreferencesFor.current = null;
    };
  }, [auth.session?.user.id]);

  useEffect(() => {
    const userId = auth.session?.user.id;
    const preferences = auth.preferences;
    if (!userId || !preferences) return;
    const fingerprint = JSON.stringify(
      normalizePlannerPreferences({
        units: preferences.units,
        temperatureUnit: preferences.temperatureUnit,
        theme: preferences.theme,
        defaultSpeed: preferences.defaultSpeed,
        acceptableStartMinutes: preferences.acceptableStartMinutes,
        acceptableEndMinutes: preferences.acceptableEndMinutes,
        weeklyStartSchedule: preferences.weeklyStartSchedule ?? null,
      }),
    );
    if (appliedPreferenceFingerprint.current === fingerprint) return;
    appliedPreferenceFingerprint.current = fingerprint;
    submittedPreferenceFingerprint.current = fingerprint;
    planner.applyRemotePreferences(preferences);
  }, [auth.preferences, auth.session?.user.id]);

  useEffect(() => {
    const userId = auth.session?.user.id;
    if (auth.status !== 'authenticated' || !userId || preferencesReadyFor !== userId) return;
    if (submittedPreferenceFingerprint.current === preferenceFingerprint) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      submittedPreferenceFingerprint.current = preferenceFingerprint;
      void auth.savePreferences(preferenceValues).catch(() => {
        if (
          loadedPreferencesFor.current === userId &&
          submittedPreferenceFingerprint.current === preferenceFingerprint
        )
          submittedPreferenceFingerprint.current = null;
      });
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [auth.status, auth.session?.user.id, preferencesReadyFor, preferenceFingerprint]);

  return null;
}

function PlannerStack() {
  const { chrome } = usePlanner();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: chrome.bg },
        headerStyle: { backgroundColor: chrome.surface },
        headerTintColor: chrome.text,
        headerTitleStyle: { fontFamily: FAMILY.displayMedium, fontSize: 17 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="getting-started" options={{ headerShown: false }} />
      <Stack.Screen
        name="planner"
        options={{ title: 'Run Planner', headerBackTitle: 'Explorer' }}
      />
      <Stack.Screen
        name="account"
        options={{
          title: 'Account',
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Settings',
        }}
      />
      <Stack.Screen
        name="strava-routes"
        options={{
          title: 'Strava routes',
        }}
      />
      <Stack.Screen
        name="route-library"
        options={{
          title: 'Route library',
        }}
      />
      <Stack.Screen name="auth/strava" options={{ headerShown: false }} />
      <Stack.Screen
        name="help"
        options={{
          title: 'Help & privacy',
        }}
      />
      <Stack.Screen
        name="watches"
        options={{
          title: 'Route watches',
        }}
      />
      <Stack.Screen name="watches/[id]" options={{ title: 'Watch' }} />
      <Stack.Screen name="watch-results/[evaluationId]" options={{ title: 'Watch result' }} />
      <Stack.Screen name="routes/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

function AuthenticatedPlanner() {
  const auth = useAuth();
  return (
    <PlannerProvider refreshPlanningBundle={auth.refreshPlanningBundle}>
      <AccountBridge />
      <PlannerStack />
    </PlannerProvider>
  );
}

function RootProviders() {
  const [fontsLoaded] = useFonts({
    Manrope_500Medium,
    Manrope_700Bold,
  });
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <IntroductionProvider>
          <AuthProvider>
            {E2E_BUILD_ENABLED ? null : <NotificationLifecycle />}
            <AuthenticatedPlanner />
          </AuthProvider>
        </IntroductionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <RootProviders />
    </AppErrorBoundary>
  );
}
