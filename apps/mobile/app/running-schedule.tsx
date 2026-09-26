import { Stack, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthProvider';
import { WeeklyStartScheduleControl } from '../src/settings/acceptable-start-window-control';
import { usePlanner } from '../src/state';
import { AppIcon } from '../src/design/Icon';
import { SP, TYPE } from '../src/theme';

export default function RunningScheduleScreen() {
  const planner = usePlanner();
  const router = useRouter();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Running schedule',
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={router.canGoBack() ? 'Back' : 'Back to Explorer'}
              testID="schedule-back"
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            >
              <AppIcon name="chevron-left" color={planner.chrome.text} size={22} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        testID="running-schedule-screen"
        style={{ flex: 1, backgroundColor: planner.chrome.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: SP[4],
          paddingTop: SP[2],
          paddingBottom: insets.bottom + SP[2],
          gap: SP[1],
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
      >
        <WeeklyStartScheduleControl planner={planner} />
        <Text
          accessibilityLiveRegion="polite"
          style={[TYPE.caption, { color: planner.chrome.textFaint }]}
        >
          {auth.status !== 'authenticated'
            ? 'Saved on this device'
            : auth.preferenceSyncStatus === 'syncing'
              ? 'Syncing…'
              : auth.preferenceSyncStatus === 'offline'
                ? 'Offline · will sync when connected'
                : auth.preferenceSyncStatus === 'conflict'
                  ? 'Settings changed elsewhere. Server settings were restored.'
                  : 'Saved to your account'}
        </Text>
      </ScrollView>
    </>
  );
}
