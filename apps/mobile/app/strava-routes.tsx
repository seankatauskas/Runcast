import type { StravaRoute } from '@runcast/contracts';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDistance } from '@runcast/core';
import { useAuth } from '../src/auth/AuthProvider';
import { ActionButton, SectionHeader, Surface } from '../src/design/Primitives';
import { usePlanner } from '../src/state';
import { SP, TYPE } from '../src/theme';

export default function StravaRoutesScreen() {
  const auth = useAuth();
  const planner = usePlanner();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const url = Linking.useURL();
  const [routes, setRoutes] = useState<StravaRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyRoute, setBusyRoute] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load(): Promise<void> {
    if (auth.status !== 'authenticated') return;
    if (url?.includes('strava=denied')) {
      setRoutes([]);
      setMessage('Strava connection was canceled. Nothing was changed.');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      if (url?.includes('strava=connected') || !auth.stravaConnected) await auth.syncNow();
      setRoutes(await auth.listStravaRoutes());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Strava routes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // The OAuth callback changes url; auth methods are stable provider actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, url]);

  async function importRoute(route: StravaRoute): Promise<void> {
    if (busyRoute) return;
    setBusyRoute(route.id);
    setMessage(null);
    try {
      const imported = await auth.importStravaRoute(route.id);
      setRoutes((current) => current.filter((item) => item.id !== route.id));
      setMessage(`${imported.name} was added to your Runcast routes.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import that route.');
    } finally {
      setBusyRoute(null);
    }
  }

  async function connect(): Promise<void> {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    try {
      await auth.connectStrava();
      setRoutes(await auth.listStravaRoutes());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start Strava connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: planner.chrome.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
    >
      <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
        Browse and import your Strava running routes into Runcast.
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

      {auth.status !== 'authenticated' ? (
        <Surface chrome={planner.chrome} style={styles.surface}>
          <Text style={[TYPE.section, { color: planner.chrome.text }]}>Sign in first</Text>
          <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
            Sign in with Strava or Apple from Account & Connections. Guest planning remains
            available without an account.
          </Text>
          <ActionButton
            label="Open Account & Connections"
            chrome={planner.chrome}
            onPress={() => router.replace('/account')}
          />
        </Surface>
      ) : !auth.stravaConnected && !url?.includes('strava=connected') ? (
        <Surface chrome={planner.chrome} style={styles.surface}>
          <Text style={[TYPE.section, { color: planner.chrome.text }]}>Connect Strava</Text>
          <ActionButton
            label={loading ? 'Opening Strava…' : 'Connect'}
            chrome={planner.chrome}
            onPress={() => void connect()}
          />
        </Surface>
      ) : (
        <>
          <SectionHeader
            title="Running routes"
            detail={loading ? 'Loading…' : `${routes.length} available`}
            chrome={planner.chrome}
          />
          {routes.map((route) => (
            <Surface key={route.id} chrome={planner.chrome} style={styles.routeRow}>
              <View style={styles.routeCopy}>
                <Text style={[TYPE.control, { color: planner.chrome.text }]}>{route.name}</Text>
                <Text style={[TYPE.support, { color: planner.chrome.textSecondary }]}>
                  {fmtDistance(route.distance, planner.units)}
                  {route.private ? ' · Private route' : ''}
                </Text>
              </View>
              <ActionButton
                label={busyRoute === route.id ? 'Importing…' : 'Import'}
                chrome={planner.chrome}
                onPress={() => void importRoute(route)}
                variant="secondary"
              />
            </Surface>
          ))}
          {!loading && routes.length === 0 ? (
            <Surface chrome={planner.chrome} style={styles.surface}>
              <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
                No additional running routes were found.
              </Text>
              <ActionButton
                label="Try again"
                chrome={planner.chrome}
                onPress={() => void load()}
                variant="secondary"
              />
            </Surface>
          ) : null}
        </>
      )}
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
  message: { padding: SP[3], borderRadius: 10, overflow: 'hidden' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: SP[3] },
  routeCopy: { flex: 1, minWidth: 0, gap: SP[1] },
});
