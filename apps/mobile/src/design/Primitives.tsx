import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Chrome } from '../theme';
import { CONTROL, RADIUS, SP, TYPE } from '../theme';
import { AppIcon, type IconName } from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function usePressMotion(pressedScale = 0.975) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const pressIn = () => {
    scale.value = withTiming(pressedScale, { duration: 90, reduceMotion: ReduceMotion.System });
    opacity.value = withTiming(0.82, { duration: 90, reduceMotion: ReduceMotion.System });
  };
  const pressOut = () => {
    scale.value = withTiming(1, { duration: 150, reduceMotion: ReduceMotion.System });
    opacity.value = withTiming(1, { duration: 150, reduceMotion: ReduceMotion.System });
  };
  return { style, pressIn, pressOut };
}

export function SectionHeader({
  title,
  detail,
  chrome,
}: {
  title: string;
  detail?: string;
  chrome: Chrome;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.eyebrow, { color: chrome.textFaint }]}>{title.toLocaleUpperCase()}</Text>
      {detail ? <Text style={[styles.detail, { color: chrome.textFaint }]}>{detail}</Text> : null}
    </View>
  );
}

export function Surface({
  children,
  chrome,
  style,
  testID,
}: {
  children: ReactNode;
  chrome: Chrome;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.surface,
        { backgroundColor: chrome.surfaceRaised, borderColor: chrome.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function IconButton({
  name,
  icon,
  label,
  chrome,
  onPress,
  active = false,
  expanded,
  disabled = false,
}: {
  name?: IconName;
  icon?: ReactNode;
  label: string;
  chrome: Chrome;
  onPress: () => void;
  active?: boolean;
  expanded?: boolean;
  disabled?: boolean;
}) {
  const motion = usePressMotion(0.94);
  const bg = active ? chrome.controlActive : chrome.surfaceRaised;
  const color = active ? chrome.controlActiveText : chrome.textSecondary;
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}
      disabled={disabled}
      hitSlop={8}
      pressRetentionOffset={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, expanded, disabled }}
      style={[
        styles.iconButton,
        motion.style,
        {
          backgroundColor: bg,
          borderColor: active ? chrome.controlActive : chrome.borderStrong,
        },
        disabled && styles.disabled,
      ]}
    >
      {icon ??
        (name ? (
          <AppIcon name={name} color={color} size={CONTROL.icon} backgroundColor={bg} />
        ) : null)}
    </AnimatedPressable>
  );
}

export function PillButton({
  children,
  chrome,
  onPress,
  active = false,
  icon,
  maxWidth,
}: {
  children: ReactNode;
  chrome: Chrome;
  onPress: () => void;
  active?: boolean;
  icon?: IconName;
  maxWidth?: number;
}) {
  const motion = usePressMotion();
  const bg = active ? chrome.controlActive : chrome.surfaceRaised;
  const color = active ? chrome.controlActiveText : chrome.textSecondary;
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.pill,
        motion.style,
        {
          backgroundColor: bg,
          borderColor: active ? chrome.controlActive : chrome.borderStrong,
          maxWidth,
        },
      ]}
    >
      {icon ? <AppIcon name={icon} color={color} size={16} backgroundColor={bg} /> : null}
      <Text numberOfLines={1} style={[TYPE.control, { color }]}>
        {children}
      </Text>
    </AnimatedPressable>
  );
}

export function ActionButton({
  label,
  chrome,
  onPress,
  testID,
  variant = 'primary',
  icon,
  trailingIcon,
  disabled = false,
  compact = false,
  wrapLabel = false,
}: {
  label: string;
  chrome: Chrome;
  onPress: () => void;
  testID?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  trailingIcon?: IconName;
  disabled?: boolean;
  compact?: boolean;
  wrapLabel?: boolean;
}) {
  const motion = usePressMotion();
  const backgroundColor =
    variant === 'primary'
      ? chrome.controlActive
      : variant === 'secondary'
        ? chrome.controlBg
        : 'transparent';
  const color =
    variant === 'primary'
      ? chrome.controlActiveText
      : variant === 'danger'
        ? chrome.danger
        : variant === 'ghost'
          ? chrome.accentInk
          : chrome.text;
  const borderColor =
    variant === 'danger' ? chrome.danger : variant === 'secondary' ? chrome.border : 'transparent';
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      style={[
        styles.action,
        compact && styles.actionCompact,
        motion.style,
        {
          backgroundColor,
          borderColor,
          borderWidth: variant === 'secondary' || variant === 'danger' ? 1 : 0,
        },
        disabled && styles.disabled,
      ]}
    >
      {icon ? (
        <AppIcon name={icon} color={color} size={17} backgroundColor={backgroundColor} />
      ) : null}
      <Text
        numberOfLines={wrapLabel ? undefined : 1}
        adjustsFontSizeToFit={compact && !wrapLabel}
        minimumFontScale={compact ? 0.84 : undefined}
        style={[
          TYPE.control,
          compact && styles.actionCompactLabel,
          { color },
          wrapLabel && { flexShrink: 1 },
        ]}
      >
        {label}
      </Text>
      {trailingIcon ? (
        <AppIcon name={trailingIcon} color={color} size={14} backgroundColor={backgroundColor} />
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SP[3],
  },
  eyebrow: TYPE.label,
  detail: { ...TYPE.caption, flexShrink: 1, textAlign: 'right' },
  surface: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.xl,
    padding: SP[4],
  },
  iconButton: {
    width: CONTROL.height,
    height: CONTROL.height,
    borderRadius: RADIUS.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    height: CONTROL.height,
    paddingHorizontal: SP[4],
    borderRadius: RADIUS.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[2],
  },
  action: {
    minHeight: CONTROL.height,
    paddingHorizontal: SP[4],
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[2],
  },
  actionCompact: { paddingHorizontal: SP[2], gap: SP[1] },
  actionCompactLabel: { minWidth: 0, flexShrink: 1, fontSize: 14, lineHeight: 18 },
  disabled: { opacity: 0.42 },
});
