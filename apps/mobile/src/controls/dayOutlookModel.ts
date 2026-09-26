import {
  fmtTemp,
  isStartWithinDailyWindow,
  presentRunConditions,
  selectPreferredStartCandidate,
  type CalendarDayWindow,
  type StartCandidateAssessmentV3,
  type TemperatureUnit,
  type ZonedDailyStartWindow,
} from '@runcast/core';

export const DAY_OUTLOOK_STEP_MS = 30 * 60_000;

export type DayRibbonState =
  'favorable' | 'mixed' | 'challenging' | 'caution' | 'ineligible' | 'past' | 'unavailable';

export type DayRibbonTone = 'favorable' | 'mixed' | 'challenging' | 'muted';

export interface DayOutlookCandidate {
  startTime: number;
  state: DayRibbonState;
  condition: string;
  temperature: string;
  facts: string;
  concern: string;
  score: number | null;
}

export interface DayRibbonSegment {
  start: number;
  end: number;
  state: DayRibbonState;
  candidateStart: number | null;
}

export function isInCalendarDay(startTime: number, window: CalendarDayWindow): boolean {
  return startTime >= window.start && startTime < window.end;
}

export function dayOffsetForStart(
  startTime: number,
  today: CalendarDayWindow,
  tomorrow: CalendarDayWindow,
): 0 | 1 | null {
  if (isInCalendarDay(startTime, today)) return 0;
  if (isInCalendarDay(startTime, tomorrow)) return 1;
  return null;
}

export function ribbonTone(state: DayRibbonState): DayRibbonTone {
  if (state === 'favorable') return 'favorable';
  if (state === 'mixed' || state === 'caution') return 'mixed';
  if (state === 'challenging' || state === 'ineligible') return 'challenging';
  return 'muted';
}

export function outlookRibbonState(
  candidate: StartCandidateAssessmentV3,
  currentTime: number,
): DayRibbonState {
  if (candidate.startTime < currentTime) return 'past';
  if (
    !candidate.evaluable ||
    candidate.safety === null ||
    candidate.conditionsFit === null ||
    candidate.plan === null
  ) {
    return 'unavailable';
  }
  if (candidate.safety.tier === 'caution') return 'caution';
  if (candidate.safety.tier === 'ineligible') return 'ineligible';
  return candidate.plan.conditionsFit.label;
}

export function presentOutlookCandidate(
  candidate: StartCandidateAssessmentV3,
  currentTime: number,
  unit: TemperatureUnit,
): DayOutlookCandidate {
  const state = outlookRibbonState(candidate, currentTime);
  if (!candidate.plan || !candidate.safety) {
    return {
      startTime: candidate.startTime,
      state,
      condition: state === 'past' ? 'Past' : 'Unavailable',
      temperature: 'Forecast unavailable',
      facts: 'Forecast unavailable',
      concern: 'Run conditions cannot be evaluated for this start',
      score: null,
    };
  }

  const conditions = presentRunConditions(candidate.plan);
  const sun =
    conditions.sunExposure.level === 'none' ? 'No sun' : `${conditions.sunExposure.label} sun`;
  return {
    startTime: candidate.startTime,
    state,
    condition:
      candidate.safety.tier === 'caution'
        ? 'Caution'
        : candidate.safety.tier === 'ineligible'
          ? 'Ineligible'
          : conditions.overallLabel,
    temperature: `${fmtTemp(candidate.plan.physicalConditions.meanTemperatureC, unit)} avg during run`,
    facts: `${fmtTemp(candidate.plan.physicalConditions.meanTemperatureC, unit)} air · ${sun} · ${conditions.windEffect.headline} wind`,
    concern: conditions.dominantFactorStory,
    score: candidate.conditionsFit === null ? null : Math.round(candidate.conditionsFit * 100),
  };
}

/** Per-day V2 recommendation using the canonical global ranking policy. */
export function preferredCandidateForDay(
  candidates: readonly StartCandidateAssessmentV3[],
  window: CalendarDayWindow,
  acceptableStartWindow?: ZonedDailyStartWindow,
): StartCandidateAssessmentV3 | null {
  return selectPreferredStartCandidate(
    candidates.filter(
      (candidate) =>
        isInCalendarDay(candidate.startTime, window) &&
        (!acceptableStartWindow ||
          isStartWithinDailyWindow(candidate.startTime, acceptableStartWindow)),
    ),
  );
}

export function buildDayRibbonSegments(
  window: CalendarDayWindow,
  candidates: readonly DayOutlookCandidate[],
  currentTime: number,
): DayRibbonSegment[] {
  const bySlot = new Map<number, DayOutlookCandidate>();
  for (const candidate of candidates) {
    if (!isInCalendarDay(candidate.startTime, window)) continue;
    const slot = Math.floor((candidate.startTime - window.start) / DAY_OUTLOOK_STEP_MS);
    bySlot.set(slot, candidate);
  }

  const count = Math.ceil((window.end - window.start) / DAY_OUTLOOK_STEP_MS);
  return Array.from({ length: count }, (_, index) => {
    const start = window.start + index * DAY_OUTLOOK_STEP_MS;
    const end = Math.min(start + DAY_OUTLOOK_STEP_MS, window.end);
    const candidate = bySlot.get(index);
    return {
      start,
      end,
      state: end <= currentTime ? 'past' : (candidate?.state ?? 'unavailable'),
      candidateStart: candidate?.startTime ?? null,
    };
  });
}

export function gridStartsForDay(
  window: CalendarDayWindow,
  minimum: number,
  maximum: number,
): number[] {
  if (![minimum, maximum].every(Number.isFinite)) return [];
  const first =
    window.start +
    Math.ceil((Math.max(window.start, minimum) - window.start) / DAY_OUTLOOK_STEP_MS) *
      DAY_OUTLOOK_STEP_MS;
  const end = Math.min(window.end - 1, maximum);
  const starts: number[] = [];
  for (let start = first; start <= end; start += DAY_OUTLOOK_STEP_MS) starts.push(start);
  return starts;
}

export function nearestGridStart(starts: readonly number[], target: number): number | null {
  if (!starts.length || !Number.isFinite(target)) return null;
  return starts.reduce((nearest, start) =>
    Math.abs(start - target) < Math.abs(nearest - target) ? start : nearest,
  );
}

export function accessibilityNudgeStart(
  startTime: number,
  direction: -1 | 1,
  window: CalendarDayWindow,
  minimum: number,
  maximum: number,
): number | null {
  const starts = gridStartsForDay(window, minimum, maximum);
  return direction === 1
    ? (starts.find((candidate) => candidate > startTime) ?? null)
    : (starts.findLast((candidate) => candidate < startTime) ?? null);
}

export function outlookAccessibilityText(
  dayLabel: string,
  candidate: DayOutlookCandidate | null,
  clockLabel: string | null,
): string {
  if (!candidate || !clockLabel) return `${dayLabel} run outlook. No evaluated start available.`;
  return `${dayLabel} run outlook. ${clockLabel}. ${candidate.condition}. ${candidate.temperature}. ${candidate.concern}.`;
}
