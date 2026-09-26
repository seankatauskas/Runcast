import {
  isStartWithinDailyWindow,
  localMinutesOfDay,
  selectPreferredStartCandidate,
  type CalendarDayWindow,
  type StartCandidateAssessmentV3,
  type StartRecommendationV3,
  type StartRecommendationStatus,
  type ZonedDailyStartWindow,
} from '@runcast/core';

export interface StartWindowBar {
  startTime: number;
  quality: number;
  evaluable: boolean;
  selected: boolean;
  recommended: boolean;
}

/** Map the chart's full touch target to its nearest visible start-time bar. */
export function startWindowBarAtX(
  bars: readonly StartWindowBar[],
  x: number,
  width: number,
): StartWindowBar | null {
  if (bars.length === 0 || !Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  const fraction = Math.min(Math.max(x / width, 0), 1);
  return bars[Math.round(fraction * (bars.length - 1))] ?? null;
}

function closestCandidateIndex(
  candidates: readonly StartCandidateAssessmentV3[],
  startTime: number | null,
): number {
  if (startTime === null || candidates.length === 0) return -1;
  const first = Math.min(...candidates.map((candidate) => candidate.startTime));
  const last = Math.max(...candidates.map((candidate) => candidate.startTime));
  if (startTime < first || startTime > last) return -1;
  return candidates.reduce(
    (closest, candidate, index) =>
      Math.abs(candidate.startTime - startTime) <
      Math.abs(candidates[closest].startTime - startTime)
        ? index
        : closest,
    0,
  );
}

export interface StartRecommendationSlice {
  status: StartRecommendationStatus;
  winner: StartCandidateAssessmentV3 | null;
  candidates: StartCandidateAssessmentV3[];
  reasons: StartRecommendationV3['reasons'];
}

/**
 * Explore advances to tomorrow once no new start can be selected at the
 * route-local end of today's acceptable recommendation window.
 */
export function exploreRecommendationDayOffset(
  currentTime: number,
  acceptableEndMinutes: number,
  timezone: string,
): 0 | 1 {
  return localMinutesOfDay(currentTime, timezone) >= acceptableEndMinutes ? 1 : 0;
}

/**
 * Explore answers the immediate question for one displayed local day.
 * Planner retains the complete multi-day recommendation for comparison.
 */
export function scopeRecommendationToDay(
  recommendation: StartRecommendationV3 | null,
  window: CalendarDayWindow,
  acceptableStartWindow?: ZonedDailyStartWindow,
): StartRecommendationSlice | null {
  if (!recommendation) return null;
  const candidates = recommendation.candidates.filter(
    (candidate) => candidate.startTime >= window.start && candidate.startTime < window.end,
  );
  const acceptableCandidates = acceptableStartWindow
    ? candidates.filter((candidate) =>
        isStartWithinDailyWindow(candidate.startTime, acceptableStartWindow),
      )
    : candidates;
  const winner = selectPreferredStartCandidate(acceptableCandidates);
  const everyEvaluableIneligible =
    acceptableCandidates.length > 0 &&
    acceptableCandidates.every(
      (candidate) => candidate.evaluable && candidate.safety?.tier === 'ineligible',
    );
  const status: StartRecommendationStatus = winner
    ? winner.safety?.tier === 'eligible'
      ? 'recommended'
      : 'caution'
    : everyEvaluableIneligible
      ? 'no-suitable-window'
      : 'unavailable';

  return {
    status,
    winner,
    candidates,
    reasons: winner
      ? [...winner.reasons]
      : status === 'no-suitable-window'
        ? ['recommendation.no-suitable-window']
        : acceptableStartWindow?.weeklySchedule &&
            candidates.length > 0 &&
            acceptableCandidates.length === 0
          ? ['recommendation.schedule-unavailable']
          : ['recommendation.input-unavailable'],
  };
}

export function runBriefPrimaryLabel(): string {
  return 'View run plan';
}

/**
 * Preserve a truthful absolute 0–1 scale and retain the selected/recommended
 * candidates even when the full 15-minute series is sampled for the compact UI.
 */
export function buildStartWindowBars(
  candidates: readonly StartCandidateAssessmentV3[],
  selectedStart: number | null,
  recommendedStart: number | null,
  count = 15,
): StartWindowBar[] {
  if (candidates.length === 0) return [];
  const sampleCount = Math.max(2, Math.floor(count));
  const selectedIndex = closestCandidateIndex(candidates, selectedStart);
  const recommendedIndex = closestCandidateIndex(candidates, recommendedStart);
  const indices = new Set<number>();

  if (candidates.length <= sampleCount) {
    candidates.forEach((_candidate, index) => indices.add(index));
  } else {
    for (let index = 0; index < sampleCount; index += 1) {
      indices.add(Math.round((index / (sampleCount - 1)) * (candidates.length - 1)));
    }
  }
  if (selectedIndex >= 0) indices.add(selectedIndex);
  if (recommendedIndex >= 0) indices.add(recommendedIndex);

  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => {
      const candidate = candidates[index];
      const rawQuality = candidate.conditionsFit ?? 0;
      return {
        startTime: candidate.startTime,
        quality: Math.min(Math.max(rawQuality, 0), 1),
        evaluable: candidate.evaluable && candidate.conditionsFit !== null,
        selected: index === selectedIndex,
        recommended: index === recommendedIndex,
      };
    });
}
