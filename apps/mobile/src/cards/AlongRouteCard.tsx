import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Planner } from '../state';
import { PlayButton } from '../controls/Controls';
import { IconButton, Surface } from '../design/Primitives';
import { RouteThumbnail } from '../map/RouteThumbnail';
import { RouteConditionsStrip } from '../strip/RouteConditionsStrip';
import { SP, TYPE } from '../theme';
import { FocusRow } from './SummaryCards';

const PLANNER_MAP_HEIGHT = 112;

/** Spatial explanation of the selected run plan, linked through the shared route focus channel. */
export function AlongRouteCard({ planner }: { planner: Planner }) {
  const { chrome } = planner;
  const { fontScale } = useWindowDimensions();
  const accessibleText = fontScale >= 1.3;
  return (
    <Surface chrome={chrome} style={styles.card}>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: chrome.textFaint }]}>
          ALONG THE ROUTE
        </Text>
        {planner.canReverse ? (
          <IconButton
            name="reverse"
            label="Reverse route direction"
            chrome={chrome}
            onPress={planner.toggleReverse}
            active={planner.reversed}
          />
        ) : null}
      </View>

      <RouteThumbnail
        route={planner.activeLegacyRoute}
        chrome={chrome}
        themeName={planner.themeName}
        height={PLANNER_MAP_HEIGHT}
      />

      <View style={[styles.insightDock, accessibleText && styles.insightDockAccessible]}>
        <PlayButton planner={planner} />
        <View style={[styles.focusReadout, accessibleText && styles.focusReadoutAccessible]}>
          <FocusRow planner={planner} />
        </View>
      </View>

      <RouteConditionsStrip
        profile={planner.routeConditionsProfile}
        chrome={chrome}
        temperatureUnit={planner.temperatureUnit}
        variant="interactive"
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { gap: SP[3] },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP[3],
  },
  title: TYPE.section,
  insightDock: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
  },
  insightDockAccessible: { flexDirection: 'column', alignItems: 'flex-start' },
  focusReadout: { flex: 1, minWidth: 0 },
  focusReadoutAccessible: { flex: 0, alignSelf: 'stretch' },
});
