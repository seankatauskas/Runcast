import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hoverBus } from '@runcast/core';
import { AlongRouteCard } from '../src/cards/AlongRouteCard';
import { Splits } from '../src/cards/Splits';
import { StartPlanCard } from '../src/cards/StartPlanCard';
import { AppIcon } from '../src/design/Icon';
import { IntroductionSpotlightOverlay } from '../src/introduction/IntroductionScreen';
import { usePlanner } from '../src/state';
import { SP, TYPE } from '../src/theme';
import { WatchRouteAction } from '../src/watches/WatchRouteAction';

export default function PlannerScreen() {
  const planner = usePlanner();
  const { chrome } = planner;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const returnToExplorer = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      hoverBus.publish({ distance: null, source: 'map' });
      return () => hoverBus.publish({ distance: null, source: 'map' });
    }, [planner.activeLegacyRoute.id, planner.speed, planner.startTime]),
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: planner.activeLegacyRoute.name,
          headerLeft: () => (
            <Pressable
              style={({ pressed }) => [styles.headerBack, pressed && { opacity: 0.6 }]}
              onPress={returnToExplorer}
              accessibilityRole="button"
              accessibilityLabel="Back to Explorer"
            >
              <AppIcon name="chevron-left" color={chrome.text} size={22} />
            </Pressable>
          ),
        }}
      />
      <StatusBar style={planner.themeName === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: chrome.bg }}>
        <ScrollView
          testID="planner-screen"
          style={{ flex: 1, backgroundColor: chrome.bg }}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP[5] }]}
          contentInsetAdjustmentBehavior="automatic"
        >
          <WatchRouteAction planner={planner} />

          <StartPlanCard planner={planner} />

          {planner.routeConditionsProfile ? (
            <>
              <AlongRouteCard planner={planner} />
              <Splits planner={planner} />
            </>
          ) : null}

          <Text style={[TYPE.caption, { color: chrome.textFaint, textAlign: 'center' }]}>
            Weather by Open-Meteo · Canopy: USDA Forest Service TCC v2025.6 · Maps © OpenFreeMap,
            OpenMapTiles & OpenStreetMap
          </Text>
        </ScrollView>
        <IntroductionSpotlightOverlay surface="planner" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  headerBack: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: SP[4],
    paddingTop: SP[5],
    gap: SP[5],
  },
});
