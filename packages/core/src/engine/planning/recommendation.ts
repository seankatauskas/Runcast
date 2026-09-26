import { contentIdentity } from './identity';
import { isStartWithinDailyWindow, type ZonedDailyStartWindow } from '../../format/units';
import type { StartCandidateAssessmentV3, StartRecommendationV3, ReasonCode } from './types';
import { PLANNING_ALGORITHM_VERSION_MANIFEST_V3 } from './versions';

export const RECOMMENDATION_GRID_MS = 15 * 60_000;
export const CONDITIONS_SUITABILITY_TIE = 0.01;

export interface RecommendStartV3Input {
  windowStart: number;
  windowEnd: number;
  decisionTime: number;
  minimumNoticeMs: number;
  validFrom: number;
  validUntil: number;
  acceptableStartWindow?: ZonedDailyStartWindow;
  inputIdentity?: unknown;
  evaluate(startTime: number): StartCandidateAssessmentV3;
}

function candidateStarts(
  input: Pick<
    RecommendStartV3Input,
    'windowStart' | 'windowEnd' | 'decisionTime' | 'minimumNoticeMs'
  >,
): number[] {
  const lowerBound = Math.max(
    input.windowStart,
    input.decisionTime + Math.max(input.minimumNoticeMs, 0),
  );
  const firstIndex = Math.max(
    0,
    Math.ceil((lowerBound - input.windowStart) / RECOMMENDATION_GRID_MS),
  );
  const starts: number[] = [];
  for (
    let startTime = input.windowStart + firstIndex * RECOMMENDATION_GRID_MS;
    startTime <= input.windowEnd;
    startTime += RECOMMENDATION_GRID_MS
  ) {
    starts.push(startTime);
  }
  return starts;
}

/**
 * Pick the preferred actionable start with the same safety-first policy used
 * by the full recommendation. Eligible starts outrank cautions; suitability
 * ties within one point resolve to the earliest start.
 */
export function selectPreferredStartCandidate<
  T extends Pick<
    StartCandidateAssessmentV3,
    'startTime' | 'evaluable' | 'safety' | 'conditionsFit'
  >,
>(candidates: readonly T[]): T | null {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.evaluable &&
      candidate.safety?.tier === 'eligible' &&
      candidate.conditionsFit !== null,
  );
  const caution = candidates.filter(
    (candidate) =>
      candidate.evaluable &&
      candidate.safety?.tier === 'caution' &&
      candidate.conditionsFit !== null,
  );
  const tier = eligible.length ? eligible : caution;
  if (!tier.length) return null;
  const bestFit = Math.max(...tier.map((candidate) => candidate.conditionsFit!));
  return tier
    .filter((candidate) => bestFit - candidate.conditionsFit! <= CONDITIONS_SUITABILITY_TIE)
    .reduce((earliest, candidate) =>
      candidate.startTime < earliest.startTime ? candidate : earliest,
    );
}

function unevaluableV3(
  candidate: StartCandidateAssessmentV3,
  reason: ReasonCode,
): StartCandidateAssessmentV3 {
  return {
    ...candidate,
    evaluable: false,
    safety: null,
    conditionsFit: null,
    plan: null,
    reasons: [...new Set([...candidate.reasons, reason])],
  };
}

/** V3 recommendation contract using the canopy-aware evaluator. */
export function recommendStartV3(input: RecommendStartV3Input): StartRecommendationV3 {
  for (const [name, value] of Object.entries({
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    decisionTime: input.decisionTime,
    minimumNoticeMs: input.minimumNoticeMs,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
  })) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  }
  if (input.windowEnd < input.windowStart) throw new RangeError('windowEnd precedes windowStart');
  if (input.validUntil < input.validFrom) throw new RangeError('validUntil precedes validFrom');

  const starts = candidateStarts(input);
  const candidates = starts.map((startTime): StartCandidateAssessmentV3 => {
    if (startTime < input.validFrom) {
      return {
        startTime,
        finishTime: null,
        evaluable: false,
        safety: null,
        conditionsFit: null,
        plan: null,
        reasons: ['weather.outside-validity'],
      };
    }
    let candidate: StartCandidateAssessmentV3;
    try {
      candidate = input.evaluate(startTime);
      if (!candidate || !Array.isArray(candidate.reasons)) {
        throw new TypeError('evaluator returned no candidate assessment');
      }
    } catch {
      return {
        startTime,
        finishTime: null,
        evaluable: false,
        safety: null,
        conditionsFit: null,
        plan: null,
        reasons: ['recommendation.input-unavailable'],
      };
    }
    candidate = { ...candidate, startTime };
    if (!candidate.evaluable || candidate.finishTime === null || candidate.safety === null) {
      return unevaluableV3(candidate, 'recommendation.input-unavailable');
    }
    if (candidate.finishTime > input.validUntil || candidate.finishTime < startTime) {
      return unevaluableV3(candidate, 'recommendation.finish-outside-validity');
    }
    return candidate;
  });

  const acceptableCandidates = input.acceptableStartWindow
    ? candidates.filter((candidate) =>
        isStartWithinDailyWindow(candidate.startTime, input.acceptableStartWindow!),
      )
    : candidates;
  const winner = selectPreferredStartCandidate(acceptableCandidates);
  const everyEvaluableIneligible =
    acceptableCandidates.length > 0 &&
    acceptableCandidates.every(
      (candidate) => candidate.evaluable && candidate.safety?.tier === 'ineligible',
    );
  const status: StartRecommendationV3['status'] = winner
    ? winner.safety?.tier === 'eligible'
      ? 'recommended'
      : 'caution'
    : everyEvaluableIneligible
      ? 'no-suitable-window'
      : 'unavailable';
  const reasons: ReasonCode[] = winner
    ? [...winner.reasons]
    : status === 'no-suitable-window'
      ? ['recommendation.no-suitable-window']
      : input.acceptableStartWindow?.weeklySchedule &&
          candidates.length > 0 &&
          acceptableCandidates.length === 0
        ? ['recommendation.schedule-unavailable']
        : ['recommendation.input-unavailable'];
  const inputHash = contentIdentity({
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    decisionTime: input.decisionTime,
    minimumNoticeMs: input.minimumNoticeMs,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    ...(input.acceptableStartWindow
      ? { acceptableStartWindow: input.acceptableStartWindow }
      : undefined),
    inputIdentity: input.inputIdentity ?? null,
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
  });
  const evaluationBody = {
    schemaVersion: 3 as const,
    status,
    winner,
    candidates,
    evaluatedCandidateCount: candidates.filter((candidate) => candidate.evaluable).length,
    unevaluableCandidateCount: candidates.filter((candidate) => !candidate.evaluable).length,
    reasons,
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
    inputHash,
  };
  return { ...evaluationBody, evaluationId: contentIdentity(evaluationBody) };
}
