import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { WEEKDAYS, type Weekday } from '@runcast/core';
import type { Planner } from '../state';
import { ActionButton } from '../design/Primitives';
import { RADIUS, SP, TYPE } from '../theme';
import {
  scheduleFromDailyWindow,
  selectedScheduleHours,
  toggleScheduleHour,
  formatScheduleIntervals,
  copyScheduleDay,
} from '../data/acceptableStartWindow';

const DAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export function WeeklyStartScheduleControl({ planner }: { planner: Planner }) {
  const [selected, setSelected] = useState<Weekday>('mon');
  const { height } = useWindowDimensions();
  const schedule = useMemo(
    () =>
      planner.weeklyStartSchedule ??
      scheduleFromDailyWindow({
        startMinutes: planner.acceptableStartMinutes,
        endMinutes: planner.acceptableEndMinutes,
      }),
    [planner.weeklyStartSchedule, planner.acceptableStartMinutes, planner.acceptableEndMinutes],
  );
  const { chrome } = planner;
  const hasHours = schedule[selected].length > 0;
  const copyHours = () => {
    const title = `Copy ${DAY_NAMES[selected]}’s hours to`;
    const copy = (days: readonly Weekday[]) =>
      planner.setWeeklyStartSchedule(copyScheduleDay(schedule, selected, days));
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: ['Weekdays', 'Weekends', 'All days', 'Cancel'],
          cancelButtonIndex: 3,
          userInterfaceStyle: planner.themeName,
        },
        (index) => {
          if (index === 0) copy(WEEKDAYS.slice(0, 5));
          if (index === 1) copy(WEEKDAYS.slice(5));
          if (index === 2) copy(WEEKDAYS);
        },
      );
    } else {
      Alert.alert(
        title,
        undefined,
        [
          { text: 'Weekdays', onPress: () => copy(WEEKDAYS.slice(0, 5)) },
          { text: 'Weekends', onPress: () => copy(WEEKDAYS.slice(5)) },
          { text: 'All days', onPress: () => copy(WEEKDAYS) },
        ],
        { cancelable: true },
      );
    }
  };
  return (
    <View style={styles.root}>
      <Text style={[TYPE.support, { color: chrome.textSecondary }]}>
        Tap the hours you’re available to start a run.
      </Text>
      <View style={[styles.axis, { paddingHorizontal: SP[3] }]} accessible={false}>
        {['12a', '6a', '12p', '6p', '12a'].map((label, i) => (
          <Text key={i} style={[TYPE.axis, { color: chrome.textFaint }]}>
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((day) => {
          const hours = selectedScheduleHours(schedule[day]);
          return (
            <View
              key={day}
              style={[
                styles.dayRow,
                {
                  borderColor: day === selected ? chrome.accentInk : chrome.border,
                  backgroundColor: chrome.surfaceRaised,
                },
              ]}
            >
              <Pressable
                onPress={() => setSelected(day)}
                accessibilityRole="button"
                accessibilityState={{ selected: day === selected }}
                accessibilityLabel={`${DAY_NAMES[day]}, ${formatScheduleIntervals(schedule[day])}`}
                testID={`schedule-day-${day}`}
                style={styles.dayHeading}
              >
                <Text style={[TYPE.control, { color: chrome.text }]}>{DAY_NAMES[day]}</Text>
                <Text
                  testID={`schedule-intervals-${day}`}
                  style={[TYPE.caption, styles.intervals, { color: chrome.textSecondary }]}
                >
                  {formatScheduleIntervals(schedule[day])}
                </Text>
              </Pressable>
              <View style={styles.hours} testID={`schedule-bar-${day}`}>
                {hours.map((enabled, hour) => (
                  <Pressable
                    key={hour}
                    testID={`schedule-hour-${day}-${hour}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: enabled }}
                    accessibilityLabel={`${DAY_NAMES[day]}, ${formatScheduleIntervals([{ startMinutes: hour * 60, endMinutes: (hour + 1) * 60 }])}`}
                    onPress={() => {
                      setSelected(day);
                      planner.setWeeklyStartSchedule({
                        ...schedule,
                        [day]: toggleScheduleHour(schedule[day], hour),
                      });
                    }}
                    style={[styles.hourTouch, height < 750 && { height: 30 }]}
                  >
                    <View
                      pointerEvents="none"
                      style={[
                        styles.hour,
                        {
                          backgroundColor: enabled ? chrome.controlActive : chrome.controlBg,
                          borderColor: enabled ? chrome.controlActive : chrome.border,
                        },
                      ]}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </View>
      <View style={[styles.actions, { borderColor: chrome.border }]}>
        <View style={styles.quickActions}>
          <Text style={[TYPE.control, { color: chrome.text, flexGrow: 1 }]}>
            {DAY_NAMES[selected]}
          </Text>
          <ActionButton
            label="Copy…"
            chrome={chrome}
            variant="ghost"
            compact
            onPress={copyHours}
            testID="schedule-copy"
          />
          <ActionButton
            label={hasHours ? 'Clear' : 'Select all'}
            chrome={chrome}
            variant="ghost"
            compact
            onPress={() =>
              planner.setWeeklyStartSchedule({
                ...schedule,
                [selected]: hasHours ? [] : [{ startMinutes: 0, endMinutes: 1440 }],
              })
            }
            testID={hasHours ? 'schedule-clear-day' : 'schedule-select-all'}
          />
        </View>
      </View>
      <Text style={[TYPE.caption, { color: chrome.textFaint }]}>
        Repeats weekly in your route’s timezone.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: SP[2] },
  week: { gap: SP[1] },
  dayRow: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP[3],
    paddingVertical: SP[1],
  },
  dayHeading: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SP[2],
  },
  intervals: { flexGrow: 1, flexShrink: 1, textAlign: 'right' },
  hours: { flexDirection: 'row' },
  hourTouch: { flex: 1, height: 36, justifyContent: 'center', paddingHorizontal: 1 },
  hour: { height: 26, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SP[2], gap: SP[1] },
  quickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SP[2],
  },
});
