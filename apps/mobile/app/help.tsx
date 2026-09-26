import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, type AccessibilityRole } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { legalUrl } from '../src/config/publicUrls';
import { SectionHeader, Surface } from '../src/design/Primitives';
import { usePlanner } from '../src/state';
import { RADIUS, SP, TYPE } from '../src/theme';

function LinkRow({
  label,
  detail,
  onPress,
  role = 'link',
  last = false,
}: {
  label: string;
  detail: string;
  onPress: () => void;
  role?: AccessibilityRole;
  last?: boolean;
}) {
  const { chrome } = usePlanner();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      style={({ pressed }) => [
        styles.linkRow,
        { borderColor: chrome.border },
        last && styles.linkRowLast,
        pressed && { opacity: 0.68 },
      ]}
    >
      <Text style={[TYPE.control, { color: chrome.accentInk }]}>{label}</Text>
      <Text style={[TYPE.support, { color: chrome.textSecondary }]}>{detail}</Text>
    </Pressable>
  );
}

export default function HelpScreen() {
  const planner = usePlanner();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: planner.chrome.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[6] }]}
    >
      <SectionHeader title="Support & privacy" chrome={planner.chrome} />
      <Surface chrome={planner.chrome} style={styles.surface}>
        <LinkRow
          label="Getting started"
          detail="Replay the introduction"
          onPress={() => router.push('/getting-started?mode=replay')}
          role="button"
        />
        <LinkRow
          label="Contact support"
          detail="support@runcast.app"
          onPress={() => void Linking.openURL('mailto:support@runcast.app')}
        />
        <LinkRow
          label="Privacy policy"
          detail="How Runcast handles account and route data"
          onPress={() => void Linking.openURL(legalUrl('privacy'))}
        />
        <LinkRow
          label={auth.status === 'authenticated' ? 'Account deletion' : 'Account controls'}
          detail={
            auth.status === 'authenticated'
              ? 'Delete your account from Account & Connections'
              : 'Sign in and manage connected data'
          }
          onPress={() => router.push('/account')}
          role="button"
          last
        />
      </Surface>

      <SectionHeader title="Reading the route ribbon" chrome={planner.chrome} />
      <Surface chrome={planner.chrome} style={styles.disclaimer}>
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          Sun uses yellow to show forecast intensity along the route: minimal, low, moderate, or
          high. Where the canopy model is active, estimated tree filtering lowers that forecast
          intensity before the yellow strip is drawn, so more-filtered sections appear less strong.
          Night sections have no yellow. Canopy filtering is an estimate rather than confirmation of
          geometric shade from individual trees, buildings, or terrain.
        </Text>
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          Wind is relative to your direction: headwind rises above calm and tailwind falls below.
          Small ticks show crosswind side and a diamond marks the strongest forecast gust.
        </Text>
      </Surface>

      <SectionHeader title="Forecast disclaimer" chrome={planner.chrome} />
      <Surface chrome={planner.chrome} style={styles.disclaimer}>
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          Runcast recommendations are estimates based on third-party forecasts, route geometry, pace
          assumptions, and a general run-conditions model. They are not a guarantee of safe
          conditions and do not replace official alerts, local guidance, or personal judgment.
        </Text>
        <Text style={[TYPE.body, { color: planner.chrome.textSecondary }]}>
          Conditions can change quickly. Do not run during lightning, flooding, extreme heat, unsafe
          access, or other hazardous conditions.
        </Text>
      </Surface>

      <Text style={[TYPE.caption, { color: planner.chrome.textFaint, textAlign: 'center' }]}>
        Runcast {Constants.expoConfig?.version ?? 'development'}
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
  surface: { paddingVertical: 0 },
  linkRow: {
    minHeight: 64,
    justifyContent: 'center',
    gap: SP[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: SP[3],
  },
  linkRowLast: { borderBottomWidth: 0 },
  disclaimer: { gap: SP[3], borderRadius: RADIUS.xl },
});
