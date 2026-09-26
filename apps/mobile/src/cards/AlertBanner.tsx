/**
 * A restrained run-warning signal shared by Explorer and Planner. The map uses
 * a compact pill; both surfaces open the same fixed warning sheet so weather
 * updates never reflow the planning controls.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AlertKind, type WeatherAlert } from '@runcast/core';
import { AppIcon } from '../design/Icon';
import type { Planner } from '../state';
import { CONTROL, RADIUS, SP, TYPE, type Chrome } from '../theme';
import { presentWeatherAlert } from './alertPresentation';

function alertColor(kind: AlertKind, chrome: Chrome): string {
  switch (kind) {
    case 'thunderstorm':
      return chrome.stormInk;
    case 'heavy-rain':
      return chrome.rainInk;
    case 'extreme-heat':
      return chrome.temperatureInk;
    case 'high-wind':
      return chrome.windInk;
  }
}

function Signal({ color, tall = false }: { color: string; tall?: boolean }) {
  return (
    <View
      style={[styles.signal, tall && styles.signalTall, { backgroundColor: color }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function warningNames(alerts: WeatherAlert[], planner: Planner): string {
  return alerts
    .map((alert) => presentWeatherAlert(alert, planner.units, planner.temperatureUnit).title)
    .join(', ');
}

function WarningSheet({
  planner,
  visible,
  onClose,
}: {
  planner: Planner;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { chrome, themeName, weatherAlerts: alerts } = planner;

  return (
    <Modal
      visible={visible && alerts.length > 0}
      transparent
      animationType="slide"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <Pressable
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor:
                themeName === 'dark' ? 'rgba(0, 0, 0, 0.62)' : 'rgba(8, 18, 15, 0.32)',
            },
          ]}
          onPress={onClose}
          accessibilityLabel="Close run warnings"
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel="Run warnings"
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, SP[4]),
              backgroundColor: chrome.cockpit,
              borderColor: chrome.cockpitBorder,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: chrome.cockpitBorder }]} />

          <View style={styles.sheetHeader}>
            <View style={styles.copy}>
              <Text style={[TYPE.label, { color: chrome.textFaint }]}>RUN CONDITIONS</Text>
              <Text style={[TYPE.title, { color: chrome.cockpitText }]}>Weather warnings</Text>
            </View>
            <Pressable
              hitSlop={8}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Done"
              style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
            >
              <Text style={[TYPE.control, { color: chrome.accentInk }]}>Done</Text>
            </Pressable>
          </View>

          <View style={[styles.sheetAlerts, { borderColor: chrome.border }]}>
            {alerts.map((alert, index) => {
              const presentation = presentWeatherAlert(
                alert,
                planner.units,
                planner.temperatureUnit,
              );
              const color = alertColor(alert.kind, chrome);
              return (
                <View
                  key={alert.kind}
                  style={[
                    styles.sheetAlert,
                    index > 0 && styles.sheetAlertBorder,
                    index > 0 && { borderColor: chrome.border },
                  ]}
                >
                  <Signal color={color} tall />
                  <View style={styles.copy}>
                    <View style={styles.alertTitleRow}>
                      <Text
                        numberOfLines={1}
                        style={[TYPE.control, styles.alertTitle, { color: chrome.cockpitText }]}
                      >
                        {presentation.title}
                      </Text>
                      <Text style={[TYPE.control, { color }]}>{presentation.metric}</Text>
                    </View>
                    <Text style={[TYPE.body, { color: chrome.cockpitTextSecondary }]}>
                      {presentation.detail}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function AlertBanner({
  planner,
  variant = 'full',
}: {
  planner: Planner;
  variant?: 'compact' | 'full' | 'rail';
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { chrome, weatherAlerts: alerts } = planner;

  useEffect(() => {
    if (alerts.length === 0) setDetailsOpen(false);
  }, [alerts.length]);

  const primaryAlert = alerts[0] ?? null;
  const primary = primaryAlert
    ? presentWeatherAlert(primaryAlert, planner.units, planner.temperatureUnit)
    : null;
  const primaryColor = primaryAlert ? alertColor(primaryAlert.kind, chrome) : chrome.textFaint;
  const moreCount = Math.max(0, alerts.length - 1);

  if (variant === 'rail' && !primaryAlert) {
    return (
      <View style={styles.clearRail} accessibilityLiveRegion="polite">
        <View style={[styles.clearDot, { backgroundColor: chrome.good }]} />
        <Text numberOfLines={1} style={[TYPE.support, { color: chrome.textSecondary }]}>
          No forecast hazards
        </Text>
      </View>
    );
  }

  if (!primaryAlert || !primary) return null;

  const isCompact = variant === 'compact';
  return (
    <>
      <Pressable
        testID="weather-warning-trigger"
        onPress={() => setDetailsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Show ${warningNames(alerts, planner)} warning details`}
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [
          isCompact ? styles.mapPill : styles.statusRail,
          isCompact && {
            backgroundColor: chrome.cockpit,
            borderColor: chrome.cockpitBorder,
          },
          pressed && styles.pressed,
        ]}
      >
        <Signal color={primaryColor} />
        <View style={styles.triggerCopy}>
          <Text
            numberOfLines={1}
            style={[
              isCompact ? TYPE.control : TYPE.support,
              { color: isCompact ? chrome.cockpitText : chrome.text },
            ]}
          >
            {primary.title}
            <Text style={{ color: primaryColor }}> · {primary.metric}</Text>
          </Text>
        </View>
        {moreCount > 0 ? (
          <View
            style={[
              styles.countBadge,
              { backgroundColor: isCompact ? chrome.cockpitRaised : chrome.surfaceMuted },
            ]}
          >
            <Text
              style={[
                TYPE.caption,
                { color: isCompact ? chrome.cockpitTextSecondary : chrome.textSecondary },
              ]}
            >
              +{moreCount}
            </Text>
          </View>
        ) : null}
        <AppIcon
          name="chevron-right"
          color={isCompact ? chrome.cockpitTextSecondary : chrome.textFaint}
          size={14}
        />
      </Pressable>

      <WarningSheet planner={planner} visible={detailsOpen} onClose={() => setDetailsOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.62 },
  mapPill: {
    minHeight: CONTROL.compactHeight,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.full,
    paddingLeft: SP[3],
    paddingRight: SP[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  statusRail: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  clearRail: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  clearDot: { width: 6, height: 6, borderRadius: 3 },
  signal: { width: 3, height: 20, borderRadius: 2, flexShrink: 0 },
  signalTall: { height: 38 },
  triggerCopy: { flexShrink: 1, minWidth: 0 },
  countBadge: {
    minWidth: 25,
    height: 24,
    paddingHorizontal: SP[2],
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: RADIUS.dock,
    borderTopRightRadius: RADIUS.dock,
    paddingHorizontal: SP[4],
    paddingTop: SP[2],
    gap: SP[4],
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: RADIUS.full,
    alignSelf: 'center',
    opacity: 0.7,
  },
  sheetHeader: {
    minHeight: CONTROL.compactHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
  },
  doneButton: {
    minWidth: CONTROL.height,
    minHeight: CONTROL.compactHeight,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sheetAlerts: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetAlert: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    paddingVertical: SP[3],
  },
  sheetAlertBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SP[3],
  },
  alertTitle: { flex: 1, minWidth: 0 },
  copy: { flex: 1, minWidth: 0 },
});
