import { describe, expect, it } from 'vitest';
import {
  actionabilityFixture,
  finishValidityFixture,
  recommendationScenarioFixtures,
} from '../../test-fixtures/evaluation-fixtures';
import type { StartCandidateAssessmentV3 } from './types';
import { recommendStartV3, selectPreferredStartCandidate } from './recommendation';

function assessment(input: {
  startTime: number;
  finishTime: number | null;
  evaluation: 'evaluated' | 'unevaluable';
  safety: 'eligible' | 'caution' | 'ineligible' | 'unknown';
  conditionsFit: number | null;
  reasons: readonly string[];
}): StartCandidateAssessmentV3 {
  return {
    startTime: input.startTime,
    finishTime: input.finishTime,
    evaluable: input.evaluation === 'evaluated',
    safety:
      input.safety === 'unknown'
        ? null
        : { tier: input.safety, policyVersion: 'safety-policy-v2', reasons: [...input.reasons] },
    conditionsFit: input.conditionsFit,
    plan: null,
    reasons: [...input.reasons],
  };
}

describe('recommendStartV3', () => {
  for (const [name, fixture] of Object.entries(recommendationScenarioFixtures)) {
    it(name, () => {
      const byStart = new Map(
        fixture.assessments.map((candidate) => [candidate.startTime, assessment(candidate)]),
      );
      const result = recommendStartV3({
        windowStart: fixture.windowStart,
        windowEnd: fixture.windowEnd,
        decisionTime: fixture.decisionTime,
        minimumNoticeMs: fixture.minimumNoticeMs,
        validFrom: fixture.validFrom,
        validUntil: fixture.validThrough,
        inputIdentity: name,
        evaluate: (startTime) => byStart.get(startTime)!,
      });
      expect(result.status).toBe(fixture.expected.status);
      expect(result.winner?.startTime ?? null).toBe(fixture.expected.winnerStart);
    });
  }

  it('rounds the actionable lower bound inward on the window-origin grid', () => {
    const starts: number[] = [];
    const result = recommendStartV3({
      ...actionabilityFixture,
      validFrom: actionabilityFixture.windowStart,
      validUntil: actionabilityFixture.windowEnd + 60 * 60_000,
      evaluate: (startTime) => {
        starts.push(startTime);
        return assessment({
          startTime,
          finishTime: startTime + 60_000,
          evaluation: 'evaluated',
          safety: 'eligible',
          conditionsFit: 0.5,
          reasons: [],
        });
      },
    });
    expect(starts).toEqual(actionabilityFixture.expectedGridStarts);
    expect(result.winner?.startTime).toBe(actionabilityFixture.expectedGridStarts[0]);
  });

  it('allows a start at windowEnd but rejects its finish beyond forecast validity', () => {
    const result = recommendStartV3({
      windowStart: finishValidityFixture.windowStart,
      windowEnd: finishValidityFixture.windowEnd,
      decisionTime: finishValidityFixture.windowStart,
      minimumNoticeMs: 0,
      validFrom: finishValidityFixture.windowStart,
      validUntil: finishValidityFixture.forecastValidThrough,
      evaluate: (startTime) =>
        assessment({
          startTime,
          finishTime: startTime + finishValidityFixture.runDurationMs,
          evaluation: 'evaluated',
          safety: 'eligible',
          conditionsFit: startTime === finishValidityFixture.windowEnd ? 1 : 0.5,
          reasons: [],
        }),
    });
    const last = result.candidates.at(-1)!;
    expect(last.startTime).toBe(finishValidityFixture.windowEnd);
    expect(last.evaluable).toBe(false);
    expect(last.reasons).toContain('recommendation.finish-outside-validity');
    expect(result.winner?.startTime).not.toBe(finishValidityFixture.windowEnd);
  });

  it('ranks only acceptable route-local starts while retaining the full series', () => {
    const start = Date.parse('2026-09-02T05:00:00.000Z');
    const result = recommendStartV3({
      windowStart: start,
      windowEnd: start + 20 * 60 * 60_000,
      decisionTime: start,
      minimumNoticeMs: 0,
      validFrom: start,
      validUntil: start + 24 * 60 * 60_000,
      acceptableStartWindow: {
        startMinutes: 5 * 60,
        endMinutes: 22 * 60,
        timezone: 'America/Chicago',
      },
      evaluate: (startTime) =>
        assessment({
          startTime,
          finishTime: startTime + 30 * 60_000,
          evaluation: 'evaluated',
          safety: 'eligible',
          conditionsFit: startTime === start ? 1 : 0.5,
          reasons: [],
        }),
    });

    expect(result.candidates[0].startTime).toBe(start);
    expect(result.winner?.startTime).toBe(Date.parse('2026-09-02T10:00:00.000Z'));
  });

  it('is byte-stable for identical inputs and assessments', () => {
    const input = recommendationScenarioFixtures.eligibleOutranksCaution;
    const byStart = new Map(
      input.assessments.map((candidate) => [candidate.startTime, assessment(candidate)]),
    );
    const evaluate = (startTime: number) => byStart.get(startTime)!;
    const args = {
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      decisionTime: input.decisionTime,
      minimumNoticeMs: input.minimumNoticeMs,
      validFrom: input.validFrom,
      validUntil: input.validThrough,
      inputIdentity: 'stable',
      evaluate,
    };
    expect(JSON.stringify(recommendStartV3(args))).toBe(JSON.stringify(recommendStartV3(args)));
  });
});

describe('selectPreferredStartCandidate', () => {
  it('prefers eligible over caution, then highest suitability, then earliest ties', () => {
    const eligibleEarly = assessment({
      startTime: 1_000,
      finishTime: 2_000,
      evaluation: 'evaluated',
      safety: 'eligible',
      conditionsFit: 0.8,
      reasons: [],
    });
    const eligibleLaterTie = assessment({
      startTime: 2_000,
      finishTime: 3_000,
      evaluation: 'evaluated',
      safety: 'eligible',
      conditionsFit: 0.805,
      reasons: [],
    });
    const caution = assessment({
      startTime: 500,
      finishTime: 1_500,
      evaluation: 'evaluated',
      safety: 'caution',
      conditionsFit: 1,
      reasons: ['safety.high-wind'],
    });

    expect(
      selectPreferredStartCandidate([caution, eligibleLaterTie, eligibleEarly])?.startTime,
    ).toBe(eligibleEarly.startTime);
  });

  it('returns null when no eligible or caution candidate is fully evaluated', () => {
    expect(
      selectPreferredStartCandidate([
        assessment({
          startTime: 1_000,
          finishTime: 2_000,
          evaluation: 'evaluated',
          safety: 'ineligible',
          conditionsFit: 1,
          reasons: ['safety.thunderstorm'],
        }),
      ]),
    ).toBeNull();
  });
});

describe('weekly recommendation availability', () => {
  const start = Date.parse('2026-09-21T05:00:00Z');
  const off = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  const args = {
    windowStart: start,
    windowEnd: start + 36 * 3600000,
    decisionTime: start,
    minimumNoticeMs: 0,
    validFrom: start,
    validUntil: start + 48 * 3600000,
    evaluate: (startTime: number) =>
      assessment({
        startTime,
        finishTime: startTime + 1800000,
        evaluation: 'evaluated',
        safety: 'eligible',
        conditionsFit: 0.8,
        reasons: [],
      }),
  };
  it('skips Monday off and picks an available Tuesday start', () => {
    const result = recommendStartV3({
      ...args,
      acceptableStartWindow: {
        startMinutes: 300,
        endMinutes: 1320,
        timezone: 'America/Chicago',
        weeklySchedule: { ...off, tue: [{ startMinutes: 360, endMinutes: 480 }] },
      },
    });
    expect(result.winner?.startTime).toBe(Date.parse('2026-09-22T11:00:00Z'));
    expect(result.candidates[0].startTime).toBe(start);
  });
  it('does not recommend a time outside an entirely unavailable week', () => {
    const result = recommendStartV3({
      ...args,
      acceptableStartWindow: {
        startMinutes: 300,
        endMinutes: 1320,
        timezone: 'America/Chicago',
        weeklySchedule: off,
      },
    });
    expect(result.winner).toBeNull();
    expect(result.reasons).toContain('recommendation.schedule-unavailable');
  });
});
