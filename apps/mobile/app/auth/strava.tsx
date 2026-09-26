import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { ActionButton, Surface } from '../../src/design/Primitives';
import { usePlanner } from '../../src/state';
import { SP, TYPE } from '../../src/theme';

export default function StravaCallbackScreen() {
  const auth = useAuth();
  const planner = usePlanner();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, strava, error } = useLocalSearchParams<{
    code?: string;
    strava?: string;
    error?: string;
  }>();
  const started = useRef(false);
  const [message, setMessage] = useState('Finishing Strava authentication…');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current || auth.status === 'hydrating') return;
    started.current = true;
    void (async () => {
      if (error === 'IDENTITY_ALREADY_LINKED') {
        throw new Error('That Strava athlete is already linked to another Runcast account.');
      }
      if (strava === 'denied') throw new Error('Strava authentication was canceled.');
      if (strava === 'connected') {
        if (auth.status !== 'authenticated') throw new Error('Sign in again to finish linking.');
        await auth.syncNow();
        router.replace('/strava-routes');
        return;
      }
      if (!code || auth.status !== 'guest') {
        throw new Error('This Strava sign-in link is no longer available.');
      }
      await auth.completeStravaSignIn(code, {
        units: planner.units,
        temperatureUnit: planner.temperatureUnit,
        theme: planner.themePreference,
        defaultSpeed: planner.speed,
        acceptableStartMinutes: planner.acceptableStartMinutes,
        acceptableEndMinutes: planner.acceptableEndMinutes,
        weeklyStartSchedule: planner.weeklyStartSchedule,
      });
      router.replace('/strava-routes');
    })().catch((caught) => {
      setMessage(caught instanceof Error ? caught.message : 'Could not finish Strava sign-in.');
      setFailed(true);
    });
  }, [auth.status, code, error, strava]);

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: planner.chrome.bg,
          paddingTop: insets.top + SP[6],
          paddingBottom: insets.bottom + SP[6],
        },
      ]}
    >
      <Surface chrome={planner.chrome} style={styles.surface}>
        {!failed ? <ActivityIndicator color={planner.chrome.accentInk} /> : null}
        <Text
          accessibilityLiveRegion="polite"
          style={[TYPE.body, { color: planner.chrome.text, textAlign: 'center' }]}
        >
          {message}
        </Text>
        {failed ? (
          <ActionButton
            label="Open Account & Connections"
            chrome={planner.chrome}
            onPress={() => router.replace('/account')}
          />
        ) : null}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', paddingHorizontal: SP[4] },
  surface: { gap: SP[4], alignItems: 'stretch' },
});
