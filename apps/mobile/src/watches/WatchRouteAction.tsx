import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { AppIcon } from '../design/Icon';
import { IntroductionTarget } from '../introduction/IntroductionTarget';
import type { Planner } from '../state';
import { RADIUS, SP, TYPE } from '../theme';

export function WatchRouteAction({ planner }: { planner: Planner }) {
  const auth = useAuth();
  const router = useRouter();
  const selected = planner.selected;
  const saved = auth.routeSummaries.find(
    (route) =>
      route.id === selected.legacyRoute.id || route.geometryIdentity === selected.geometryIdentity,
  );

  function begin(): void {
    if (auth.status !== 'authenticated') {
      Alert.alert(
        'Sign in to watch this route',
        'Your selected route will stay in the planner. After sign-in, Runcast will ask before uploading it to your account.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Continue',
            onPress: () =>
              router.push(
                `/account?watchRoute=${encodeURIComponent(selected.legacyRoute.id)}&watchGeometry=${encodeURIComponent(selected.geometryIdentity)}`,
              ),
          },
        ],
      );
      return;
    }
    if (saved) {
      router.push(`/watches?routeId=${encodeURIComponent(saved.id)}`);
      return;
    }
    router.push(
      `/watches?pendingRouteId=${encodeURIComponent(selected.legacyRoute.id)}&routeGeometry=${encodeURIComponent(selected.geometryIdentity)}`,
    );
  }

  const title = saved ? 'Manage route watch' : 'Watch this route';
  const detail = saved ? 'Schedule and alerts' : 'Get notified when conditions line up';

  return (
    <IntroductionTarget id="watch-route">
      <Pressable
        testID="watch-route-action"
        onPress={begin}
        accessibilityRole="button"
        accessibilityLabel={saved ? 'Manage route watch' : 'Set a watch for this route'}
        accessibilityHint="Opens watch schedule and alert settings"
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: planner.chrome.surfaceRaised,
            borderColor: planner.chrome.border,
            opacity: pressed ? 0.72 : 1,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}
      >
        <View
          style={[
            styles.icon,
            {
              backgroundColor: planner.chrome.controlBg,
              borderColor: planner.chrome.border,
            },
          ]}
        >
          <AppIcon name="eye" color={planner.chrome.accentInk} size={24} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: planner.chrome.text }]}>{title}</Text>
          <Text style={[styles.detail, { color: planner.chrome.textSecondary }]}>{detail}</Text>
        </View>
        <AppIcon name="chevron-right" color={planner.chrome.textFaint} size={16} />
      </Pressable>
    </IntroductionTarget>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 84,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP[4],
    paddingVertical: SP[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: TYPE.section,
  detail: { ...TYPE.support, marginTop: 2 },
});
