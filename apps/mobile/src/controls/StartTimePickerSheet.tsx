import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Planner } from '../state';
import { ActionButton, IconButton } from '../design/Primitives';
import { RADIUS, SHADOW, SP, TYPE } from '../theme';
import { DayRunOutlook } from './DayRunOutlook';

export function StartTimePickerSheet({
  planner,
  visible,
  onClose,
}: {
  planner: Planner;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { chrome } = planner;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={onClose}
          accessibilityLabel="Close start time selector"
        />
        <View
          testID="start-time-picker-sheet"
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, SP[4]),
              backgroundColor: chrome.surfaceRaised,
              borderColor: chrome.borderStrong,
            },
          ]}
        >
          <View style={styles.handleWrap} accessible={false}>
            <View style={[styles.handle, { backgroundColor: chrome.borderStrong }]} />
          </View>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[TYPE.section, { color: chrome.text }]}>Choose start time</Text>
              <Text style={[TYPE.support, { color: chrome.textSecondary }]}>
                The full route forecast updates with your start.
              </Text>
            </View>
            <IconButton
              name="close"
              label="Close start time selector"
              chrome={chrome}
              onPress={onClose}
            />
          </View>

          <ScrollView
            style={styles.scroll}
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <DayRunOutlook planner={planner} presentation="sheet" />
          </ScrollView>

          <View style={[styles.footer, { borderColor: chrome.border }]}>
            <ActionButton
              label="Done"
              chrome={chrome}
              onPress={onClose}
              testID="start-time-picker-done"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.42)' },
  sheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '88%',
    alignSelf: 'center',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP[4],
    paddingTop: SP[2],
    gap: SP[3],
    shadowColor: SHADOW.color,
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },
  handleWrap: { alignItems: 'center' },
  handle: { width: 36, height: 4, borderRadius: RADIUS.full },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SP[3] },
  headerCopy: { flex: 1, minWidth: 0, gap: SP[1] },
  scroll: { flexGrow: 0 },
  content: { paddingVertical: SP[1], gap: SP[4] },
  footer: {
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SP[2],
    alignItems: 'flex-end',
  },
});
