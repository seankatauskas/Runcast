import {
  calendarDayWindow,
  isStartWithinDailyWindow,
  fmtClock,
  fmtDay,
  fmtDuration,
  presentRunConditions,
  type EvaluatedRunV3,
  type StartRecommendationV3,
  type TemperatureUnit,
  type ZonedDailyStartWindow,
} from '@runcast/core';
import { exploreRecommendationDayOffset, scopeRecommendationToDay } from './runBriefModel';

export function recommendationForStartDay(
  recommendation: StartRecommendationV3 | null,
  start: number,
  window: ZonedDailyStartWindow,
  advanceAfterCutoff = false,
) {
  if (advanceAfterCutoff && window.weeklySchedule) {
    const next = recommendation?.candidates.find(
      (candidate) =>
        candidate.startTime >= start && isStartWithinDailyWindow(candidate.startTime, window),
    );
    const day = calendarDayWindow(next?.startTime ?? start, window.timezone, 0);
    return scopeRecommendationToDay(recommendation, day, window);
  }
  const day = calendarDayWindow(
    start,
    window.timezone,
    advanceAfterCutoff
      ? exploreRecommendationDayOffset(start, window.endMinutes, window.timezone)
      : 0,
  );
  return scopeRecommendationToDay(recommendation, day, window);
}

export function finishSummary(
  start: number,
  finish: number,
  duration: number,
  timezone?: string,
): string {
  const zone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const day = calendarDayWindow(start, zone, 0);
  const otherDay = finish >= day.end || finish < day.start;
  return `Est. finish ${otherDay ? `${fmtDay(finish, zone)} · ` : ''}${fmtClock(finish, zone)} · ${fmtDuration(duration)}`;
}

interface Difference {
  key: string;
  copy: string;
  magnitude: number;
  impact: number;
}
export interface StartComparison {
  reference: string;
  status: 'selected' | 'similar' | 'different' | 'unavailable';
  observations: string[];
  warning: string | null;
}

/** Explorer confirms the best start or briefly describes meaningful differences. */
export function explorerComparisonSummary(comparison: StartComparison): string | null {
  if (comparison.status === 'selected') {
    return comparison.warning ? 'Best available time for this day' : 'Best time for this day';
  }
  if (comparison.status !== 'different') return null;
  return comparison.observations
    .map((copy) =>
      copy
        .replace(/ air$/, '')
        .replace('Peak feels like ', 'Feels like ')
        .replace('Peak rain chance ', 'Rain chance '),
    )
    .join(' · ');
}

/** Describes physical changes without interpreting colder weather as inherently better. */
export function compareRunStarts(
  selected: EvaluatedRunV3 | null,
  recommended: EvaluatedRunV3 | null,
  temperatureUnit: TemperatureUnit,
  timezone?: string,
): StartComparison {
  const reference = recommended
    ? `vs recommended ${fmtClock(recommended.startTime, timezone)}`
    : 'Start-time comparison';
  if (
    !selected ||
    !recommended ||
    selected.routeId !== recommended.routeId ||
    selected.startTime <
      calendarDayWindow(
        recommended.startTime,
        timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        0,
      ).start ||
    selected.startTime >=
      calendarDayWindow(
        recommended.startTime,
        timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        0,
      ).end
  ) {
    return {
      reference,
      status: 'unavailable',
      observations: ['Comparison unavailable.'],
      warning: null,
    };
  }
  const warning =
    selected.safety.tier === 'ineligible'
      ? 'This start has forecast hazards. Review run warnings.'
      : selected.safety.tier === 'caution'
        ? 'This start has weather cautions. Review run warnings.'
        : recommended.safety.tier !== 'eligible'
          ? 'The recommended start also has weather cautions.'
          : null;
  if (selected.startTime === recommended.startTime) {
    return {
      reference: `Recommended · ${fmtClock(recommended.startTime, timezone)}`,
      status: 'selected',
      observations: [],
      warning,
    };
  }
  const a = selected.physicalConditions;
  const b = recommended.physicalConditions;
  const shown = presentRunConditions(selected);
  const baseline = presentRunConditions(recommended);
  const differences: Difference[] = [];
  const add = (key: string, copy: string, magnitude: number) =>
    differences.push({
      key,
      copy,
      magnitude,
      impact:
        (selected.conditionsFit.factors[key] ?? 0) - (recommended.conditionsFit.factors[key] ?? 0),
    });
  const degrees = (delta: number) =>
    `${Math.round(Math.abs(delta) * (temperatureUnit === 'fahrenheit' ? 1.8 : 1))}°`;
  const temperature = a.meanTemperatureC - b.meanTemperatureC;
  if (Math.abs(temperature) >= 1) {
    add(
      'temperature',
      `${degrees(temperature)} ${temperature < 0 ? 'cooler' : 'warmer'} air`,
      Math.abs(temperature),
    );
  } else if (Math.abs(a.peaks.feelsLikeC - b.peaks.feelsLikeC) >= 1) {
    const lower = a.peaks.feelsLikeC < b.peaks.feelsLikeC;
    add(
      'temperature',
      `Peak feels like ${degrees(a.peaks.feelsLikeC - b.peaks.feelsLikeC)} ${lower ? 'lower' : 'higher'}`,
      Math.abs(a.peaks.feelsLikeC - b.peaks.feelsLikeC),
    );
  }
  if (shown.sunExposure.level !== baseline.sunExposure.level) {
    add(
      'radiation',
      `${a.radiationDoseJm2 < b.radiationDoseJm2 ? 'Less' : 'More'} sun (est.)`,
      Math.abs(a.radiationDoseJm2 - b.radiationDoseJm2) / 100_000,
    );
  }
  if (shown.windEffect.level !== baseline.windEffect.level) {
    add(
      'aerodynamicOpposition',
      `${a.meanAerodynamicOpposition < b.meanAerodynamicOpposition ? 'Less' : 'More'} wind resistance`,
      Math.abs(a.meanAerodynamicOpposition - b.meanAerodynamicOpposition) / 0.02,
    );
  }
  const rain = a.peaks.precipitationProbabilityPct - b.peaks.precipitationProbabilityPct;
  if (Math.abs(rain) >= 10) {
    add(
      'precipitation',
      `Peak rain chance ${rain < 0 ? '−' : '+'}${Math.round(Math.abs(rain))} points`,
      Math.abs(rain) / 10,
    );
  }
  differences.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact) || b.magnitude - a.magnitude);
  const improvement = differences.find((d) => d.impact < 0);
  const worsening = differences.find((d) => d.impact > 0);
  const chosen = improvement && worsening ? [improvement, worsening] : differences.slice(0, 2);
  return {
    reference,
    status: chosen.length ? 'different' : 'similar',
    observations: chosen.length ? chosen.map((d) => d.copy) : ['Similar conditions.'],
    warning,
  };
}
