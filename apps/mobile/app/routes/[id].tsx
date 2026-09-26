import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import {
  missingRouteTerminal,
  validDeepLinkStart,
  type DeepLinkTerminal,
} from '../../src/notifications/deepLinkState';
import { usePlanner } from '../../src/state';
import { RADIUS, SP, TYPE } from '../../src/theme';

const HYDRATION_TIMEOUT_MS = 8_000;
const SYNC_TIMEOUT_MS = 10_000;

type Phase = 'hydrating' | 'syncing' | DeepLinkTerminal;

function terminalCopy(phase: DeepLinkTerminal): { title: string; detail: string } {
  switch (phase) {
    case 'deleted':
      return {
        title: 'Route was deleted',
        detail: 'This saved route is no longer in your Runcast account.',
      };
    case 'offline':
      return {
        title: 'Route unavailable offline',
        detail: 'Runcast could not finish syncing this route. Check your connection and retry.',
      };
    case 'signed-out':
      return {
        title: 'Sign in to open this route',
        detail: 'This notification belongs to a saved route in your Runcast account.',
      };
    default:
      return {
        title: 'Route not found',
        detail: 'The notification route is missing or is not available to this account.',
      };
  }
}

export default function RouteDeepLink() {
  const params = useLocalSearchParams<{ id?: string | string[]; start?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const start = Array.isArray(params.start) ? params.start[0] : params.start;
  const router = useRouter();
  const planner = usePlanner();
  const auth = useAuth();
  const [phase, setPhase] = useState<Phase>('hydrating');
  const attempts = useRef(0);
  const routesRef = useRef(planner.routes);
  const syncStatusRef = useRef(auth.syncStatus);
  const knownAtOpen = useRef(
    Boolean(
      id &&
      (planner.routes.some((route) => route.legacyRoute.id === id) ||
        auth.routeSummaries.some((route) => route.id === id)),
    ),
  );
  routesRef.current = planner.routes;
  syncStatusRef.current = auth.syncStatus;
  if (
    id &&
    (planner.routes.some((route) => route.legacyRoute.id === id) ||
      auth.routeSummaries.some((route) => route.id === id))
  ) {
    knownAtOpen.current = true;
  }

  const openRoute = useCallback((): boolean => {
    const route = routesRef.current.find((entry) => entry.legacyRoute.id === id);
    if (!route) return false;
    knownAtOpen.current = true;
    planner.selectRoute(route.legacyRoute.id);
    const recommendedStart = validDeepLinkStart(start);
    if (recommendedStart !== null) planner.setStartTime(recommendedStart);
    router.replace('/planner');
    return true;
  }, [id, planner, router, start]);

  const syncOnce = useCallback(async (): Promise<void> => {
    if (!id || attempts.current >= 2) return;
    attempts.current += 1;
    setPhase('syncing');
    const result = await Promise.race([
      auth.syncNow().then(() => 'complete' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), SYNC_TIMEOUT_MS)),
    ]);
    if (openRoute()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (openRoute()) return;
    setPhase(
      missingRouteTerminal({
        authenticated: auth.status === 'authenticated',
        syncOffline: result === 'timeout' || syncStatusRef.current === 'offline',
        wasKnown: knownAtOpen.current,
      }),
    );
  }, [auth, id, openRoute]);

  useEffect(() => {
    if (openRoute()) return;
    if (!id) {
      setPhase('missing');
      return;
    }
    if (auth.status === 'guest') {
      setPhase('signed-out');
      return;
    }
    if (auth.status === 'authenticated' && attempts.current === 0) void syncOnce();
  }, [auth.status, id, openRoute, planner.routes, syncOnce]);

  useEffect(() => {
    if (auth.status !== 'hydrating') return;
    const timeout = setTimeout(() => setPhase('offline'), HYDRATION_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [auth.status]);

  const terminal = phase !== 'hydrating' && phase !== 'syncing' ? terminalCopy(phase) : null;
  return (
    <View
      testID={terminal ? 'route-deep-link-terminal' : 'route-deep-link-loading'}
      style={[styles.container, { backgroundColor: planner.chrome.bg }]}
    >
      {terminal ? (
        <>
          <Text
            testID="route-deep-link-title"
            style={[TYPE.title, { color: planner.chrome.text, textAlign: 'center' }]}
          >
            {terminal.title}
          </Text>
          <Text style={[TYPE.body, { color: planner.chrome.textSecondary, textAlign: 'center' }]}>
            {terminal.detail}
          </Text>
          {phase === 'signed-out' ? (
            <RouteAction
              testID="route-deep-link-account"
              label="Open account"
              onPress={() => router.replace('/account')}
              background={planner.chrome.controlActive}
              color={planner.chrome.controlActiveText}
            />
          ) : auth.status === 'authenticated' && attempts.current < 2 ? (
            <RouteAction
              testID="route-deep-link-retry"
              label="Retry once"
              onPress={() => void syncOnce()}
              background={planner.chrome.controlActive}
              color={planner.chrome.controlActiveText}
            />
          ) : null}
          <RouteAction
            testID="route-deep-link-back"
            label="Back to Explorer"
            onPress={() => router.replace('/')}
            background={planner.chrome.surfaceRaised}
            color={planner.chrome.text}
          />
        </>
      ) : (
        <>
          <ActivityIndicator color={planner.chrome.accentInk} />
          <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
            {phase === 'syncing' ? 'Syncing saved route…' : 'Opening saved route…'}
          </Text>
        </>
      )}
    </View>
  );
}

function RouteAction({
  label,
  onPress,
  background,
  color,
  testID,
}: {
  label: string;
  onPress: () => void;
  background: string;
  color: string;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: background, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Text style={[TYPE.control, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[3],
    padding: SP[6],
  },
  action: {
    minWidth: 200,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
    paddingHorizontal: SP[4],
  },
});
