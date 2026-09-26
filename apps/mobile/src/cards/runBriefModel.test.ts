import type { StartCandidateAssessmentV3 } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import type { StartRecommendationV3 } from '@runcast/core';
import {
  buildStartWindowBars,
  exploreRecommendationDayOffset,
  runBriefPrimaryLabel,
  scopeRecommendationToDay,
  startWindowBarAtX,
} from './runBriefModel';

const QUARTER_HOUR = 15 * 60_000;

function candidate(index: number, quality = index / 100): StartCandidateAssessmentV3 {
  return {
    startTime: index * QUARTER_HOUR,
    finishTime: (index + 4) * QUARTER_HOUR,
    evaluable: true,
    safety: { tier: 'eligible', policyVersion: 'test', reasons: [] },
    conditionsFit: quality,
    plan: null,
    reasons: [],
  };
}

describe('run brief actions', () => {
  it('uses the same primary action for every start time', () => {
    expect(runBriefPrimaryLabel()).toBe('View run plan');
  });
});

describe('start window bars', () => {
  it('maps the whole chart touch target to the nearest visible bar', () => {
    const bars = buildStartWindowBars(
      [candidate(0), candidate(1), candidate(2), candidate(3), candidate(4)],
      null,
      candidate(2).startTime,
    );

    expect(startWindowBarAtX(bars, -20, 100)?.startTime).toBe(candidate(0).startTime);
    expect(startWindowBarAtX(bars, 50, 100)?.startTime).toBe(candidate(2).startTime);
    expect(startWindowBarAtX(bars, 120, 100)?.startTime).toBe(candidate(4).startTime);
    expect(startWindowBarAtX(bars, 50, 0)).toBeNull();
  });

  it('omits the selected marker in the recommendation-first Explore presentation', () => {
    const candidates = Array.from({ length: 24 }, (_, index) => candidate(index, 0.5));
    const recommendedStart = candidates[15].startTime;

    const bars = buildStartWindowBars(candidates, null, recommendedStart, 8);

    expect(bars.some((bar) => bar.selected)).toBe(false);
    expect(bars.find((bar) => bar.recommended)?.startTime).toBe(recommendedStart);
  });

  it('moves the selected marker without moving the independent recommendation', () => {
    const candidates = Array.from({ length: 24 }, (_, index) => candidate(index, 0.5));
    const recommendedStart = candidates[15].startTime;

    const before = buildStartWindowBars(candidates, candidates[4].startTime, recommendedStart, 8);
    const after = buildStartWindowBars(candidates, candidates[9].startTime, recommendedStart, 8);

    expect(before.find((bar) => bar.selected)?.startTime).toBe(candidates[4].startTime);
    expect(after.find((bar) => bar.selected)?.startTime).toBe(candidates[9].startTime);
    expect(before.find((bar) => bar.recommended)?.startTime).toBe(recommendedStart);
    expect(after.find((bar) => bar.recommended)?.startTime).toBe(recommendedStart);
  });

  it('retains selected and recommended candidates when downsampling', () => {
    const candidates = Array.from({ length: 96 }, (_, index) => candidate(index, 0.75));
    const bars = buildStartWindowBars(
      candidates,
      candidates[37].startTime,
      candidates[62].startTime,
      12,
    );

    expect(bars.some((bar) => bar.selected && bar.startTime === candidates[37].startTime)).toBe(
      true,
    );
    expect(bars.some((bar) => bar.recommended && bar.startTime === candidates[62].startTime)).toBe(
      true,
    );
  });

  it('uses absolute suitability values instead of exaggerating tiny differences', () => {
    const bars = buildStartWindowBars([candidate(0, 0.72), candidate(1, 0.73)], 0, QUARTER_HOUR);

    expect(bars.map((bar) => bar.quality)).toEqual([0.72, 0.73]);
  });

  it('clamps malformed quality values and marks missing values unavailable', () => {
    const missing = { ...candidate(1), conditionsFit: null, evaluable: false };
    const bars = buildStartWindowBars(
      [candidate(0, -1), missing, candidate(2, 3)],
      QUARTER_HOUR,
      null,
    );

    expect(bars.map((bar) => bar.quality)).toEqual([0, 0, 1]);
    expect(bars[1].evaluable).toBe(false);
  });

  it('does not mark an out-of-day selected start as the nearest today bar', () => {
    const candidates = [candidate(4, 0.7), candidate(5, 0.8)];
    const bars = buildStartWindowBars(candidates, candidate(30).startTime, candidates[1].startTime);

    expect(bars.some((bar) => bar.selected)).toBe(false);
    expect(bars.find((bar) => bar.recommended)?.startTime).toBe(candidates[1].startTime);
  });
});

describe('Explore today recommendation', () => {
  function recommendation(candidates: StartRecommendationV3['candidates']): StartRecommendationV3 {
    return {
      schemaVersion: 3,
      status: 'recommended',
      winner: candidates.at(-1) ?? null,
      candidates,
      evaluatedCandidateCount: candidates.length,
      unevaluableCandidateCount: 0,
      reasons: [],
      versions: {
        build: 'test',
        route: 'test',
        timing: 'test',
        weatherNormalizer: 'test',
        weatherSampler: 'test',
        exposure: 'test',
        canopy: 'test',
        wind: 'test',
        physicalConditions: 'test',
        preference: 'test',
        safety: 'test',
        recommendation: 'test',
        explanation: 'test',
      },
      evaluationId: 'test',
      inputHash: 'test',
    };
  }

  it('chooses the best start today even when tomorrow scores higher', () => {
    const todayEarly = candidate(4, 0.62);
    const todayBest = candidate(8, 0.81);
    const tomorrowBest = candidate(100, 0.99);
    const result = scopeRecommendationToDay(recommendation([todayEarly, todayBest, tomorrowBest]), {
      start: 0,
      end: 24 * 60 * 60_000,
    });

    expect(result?.winner?.startTime).toBe(todayBest.startTime);
    expect(result?.candidates).toEqual([todayEarly, todayBest]);
    expect(result?.status).toBe('recommended');
  });

  it('reports no recommendation today when only tomorrow has candidates', () => {
    const result = scopeRecommendationToDay(recommendation([candidate(100, 0.99)]), {
      start: 0,
      end: 24 * 60 * 60_000,
    });

    expect(result).toMatchObject({ status: 'unavailable', winner: null, candidates: [] });
  });

  it('keeps the day curve but honors the acceptable start window when choosing a winner', () => {
    const earlyBest = candidate(5, 0.99);
    const acceptable = candidate(10, 0.8);
    const result = scopeRecommendationToDay(
      recommendation([earlyBest, acceptable]),
      { start: 0, end: 24 * 60 * 60_000 },
      { startMinutes: 150, endMinutes: 210, timezone: 'UTC' },
    );

    expect(result?.candidates).toEqual([earlyBest, acceptable]);
    expect(result?.winner).toBe(acceptable);
  });
});

describe('Explore recommendation day', () => {
  it('keeps today before the acceptable cutoff and advances at the cutoff', () => {
    const timezone = 'America/Chicago';

    expect(
      exploreRecommendationDayOffset(Date.parse('2026-09-03T02:59:00.000Z'), 22 * 60, timezone),
    ).toBe(0);
    expect(
      exploreRecommendationDayOffset(Date.parse('2026-09-03T03:00:00.000Z'), 22 * 60, timezone),
    ).toBe(1);
  });
});
