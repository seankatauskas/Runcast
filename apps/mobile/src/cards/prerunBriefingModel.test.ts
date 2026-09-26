import { describe, expect, it, vi } from 'vitest';
import { recommendStartV3, type EvaluatedRunV3 } from '@runcast/core';
import {
  compareRunStarts,
  explorerComparisonSummary,
  finishSummary,
  recommendationForStartDay,
} from './prerunBriefingModel';

const start = Date.parse('2026-09-19T11:00:00Z');
function plan(time = start): EvaluatedRunV3 {
  return {
    schemaVersion: 3,
    canopyModelMode: 'off',
    routeId: 'lake',
    startTime: time,
    finishTime: time + 3600_000,
    durationSeconds: 3600,
    timingQuality: 'grade-adjusted',
    paceModelVersion: 'test',
    safety: { tier: 'eligible', policyVersion: 'test', reasons: [] },
    physicalConditions: {
      meanTemperatureC: 20,
      openSkyRadiationDoseJm2: 200_000,
      canopyAdjustedRadiationDoseJm2: 200_000,
      openSkyDirectNormalRadiationDoseJm2: 150_000,
      canopyAdjustedDirectNormalRadiationDoseJm2: 150_000,
      radiationDoseJm2: 200_000,
      directNormalRadiationDoseJm2: 150_000,
      diffuseRadiationDoseJm2: 50_000,
      precipitationAmountMm: 0,
      meanApparentAirflowMs: 3,
      meanAerodynamicOpposition: 0.04,
      peaks: {
        feelsLikeC: 22,
        gustMs: 5,
        precipitationRateMmH: 0,
        precipitationProbabilityPct: 20,
      },
    },
    exposureSummary: {
      geometricSolarElevationDeg: { minimum: 5, maximum: 15 },
      apparentSolarElevationDeg: { minimum: 5, maximum: 15 },
      daylightFraction: 1,
      mappedWoodlandFraction: null,
      coverageCompleteness: 'unknown',
      canopyAvailableFraction: 0,
      meanCanopyPct: null,
      meanBlockedDirectFraction: 0,
      canopyCompleteness: 'unavailable',
    },
    conditionsFit: {
      value: 0.8,
      label: 'favorable',
      version: 'test',
      factors: {
        temperature: 0.05,
        radiation: 0.05,
        aerodynamicOpposition: 0.04,
        precipitation: 0.05,
      },
    },
    evaluationId: 'test',
    reasons: [],
  };
}
const compare = (selected: EvaluatedRunV3 | null, recommended: EvaluatedRunV3 | null = plan()) =>
  compareRunStarts(selected, recommended, 'celsius', 'America/Chicago');

describe('departure comparison', () => {
  it('identifies the recommended start without inventing an improvement', () => {
    expect(compare(plan())).toMatchObject({
      status: 'selected',
      observations: [],
      warning: null,
    });
  });
  it('suppresses small changes and treats the threshold consistently in either unit', () => {
    const selected = plan(start + 3600_000);
    selected.physicalConditions.meanTemperatureC += 0.99;
    selected.physicalConditions.peaks.precipitationProbabilityPct += 9.99;
    expect(compare(selected).status).toBe('similar');
    selected.physicalConditions.meanTemperatureC = 21;
    expect(compare(selected).observations[0]).toContain('1° warmer air');
    expect(
      compareRunStarts(selected, plan(), 'fahrenheit', 'America/Chicago').observations[0],
    ).toBe('2° warmer air');
  });
  it('shows an improvement and a worsening, even when two other improvements are stronger', () => {
    const selected = plan(start + 3600_000);
    selected.physicalConditions.meanTemperatureC = 18;
    selected.conditionsFit.factors.temperature = 0;
    selected.physicalConditions.radiationDoseJm2 = 50_000;
    selected.conditionsFit.factors.radiation = 0;
    selected.physicalConditions.peaks.precipitationProbabilityPct = 30;
    selected.conditionsFit.factors.precipitation = 0.06;
    const result = compare(selected);
    expect(result.observations).toHaveLength(2);
    expect(result.observations[1]).toContain('Peak rain chance +10 points');
    expect(result.observations[0]).not.toMatch(/better|safer/i);
  });
  it('detects a material feels-like change even with steady air temperature', () => {
    const selected = plan(start + 3600_000);
    selected.physicalConditions.peaks.feelsLikeC = 25;
    expect(compare(selected).observations[0]).toContain('Peak feels like 3° higher');
  });
  it('uses sun and wind bands, and does not claim shade', () => {
    const selected = plan(start + 3600_000);
    selected.physicalConditions.radiationDoseJm2 = 600_000;
    selected.physicalConditions.meanAerodynamicOpposition = 0.1;
    selected.conditionsFit.factors.aerodynamicOpposition = 0.1;
    expect(compare(selected).observations).toEqual(['More wind resistance', 'More sun (est.)']);
  });
  it('keeps warnings visible even when physical differences are negligible', () => {
    const selected = plan(start + 3600_000);
    selected.safety = {
      tier: 'ineligible',
      policyVersion: 'test',
      reasons: ['safety.thunderstorm'],
    };
    expect(compare(selected)).toMatchObject({
      status: 'similar',
      warning: expect.stringContaining('forecast hazards'),
    });
  });
  it('never compares another route, another local day, or a missing forecast', () => {
    expect(compare(null).status).toBe('unavailable');
    expect(compare(plan(), null).status).toBe('unavailable');
    expect(compare({ ...plan(), routeId: 'park' }).status).toBe('unavailable');
    expect(compare(plan(start + 24 * 3600_000)).status).toBe('unavailable');
    // Both instants are Sep 20 UTC but straddle local midnight.
    expect(
      compareRunStarts(
        plan(Date.parse('2026-09-20T05:30:00Z')),
        plan(Date.parse('2026-09-20T04:30:00Z')),
        'celsius',
        'America/Chicago',
      ).status,
    ).toBe('unavailable');
  });
});

describe('estimated finish', () => {
  it('uses device-local time when a route timezone is not yet available', () => {
    vi.stubEnv('TZ', 'America/Chicago');
    try {
      const late = Date.parse('2026-09-20T04:30:00Z');
      expect(finishSummary(late, late + 3600_000, 3600)).toBe(
        finishSummary(late, late + 3600_000, 3600, 'America/Chicago'),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('uses route-local time and includes the date only when crossing midnight', () => {
    const ordinary = finishSummary(start, start + 3600_000, 3600, 'America/Chicago');
    expect(ordinary).toContain('7:00');
    expect(ordinary).not.toContain('Sep');
    const late = Date.parse('2026-09-20T04:30:00Z');
    const overnight = finishSummary(late, late + 3600_000, 3600, 'America/Chicago');
    expect(overnight).toContain('Sep 20');
    expect(overnight).toContain('12:30');
  });
});

it('advances the briefing past days off to the next available block', () => {
  const now = Date.parse('2026-09-21T05:00:00Z');
  const window = {
    startMinutes: 300,
    endMinutes: 1320,
    timezone: 'America/Chicago',
    weeklySchedule: {
      mon: [],
      tue: [
        { startMinutes: 360, endMinutes: 480 },
        { startMinutes: 1020, endMinutes: 1140 },
      ],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    },
  };
  const recommendation = recommendStartV3({
    windowStart: now,
    windowEnd: now + 42 * 3600000,
    decisionTime: now,
    minimumNoticeMs: 0,
    validFrom: now,
    validUntil: now + 48 * 3600000,
    acceptableStartWindow: window,
    evaluate: (startTime) => ({
      startTime,
      finishTime: startTime + 3600000,
      evaluable: true,
      safety: { tier: 'eligible', policyVersion: 'test', reasons: [] },
      conditionsFit: 0.8,
      plan: plan(startTime),
      reasons: [],
    }),
  });
  expect(recommendationForStartDay(recommendation, now, window, true)?.winner?.startTime).toBe(
    Date.parse('2026-09-22T11:00:00Z'),
  );
  expect(recommendationForStartDay(recommendation, now, window)?.winner).toBeNull();
});

describe('compact Explorer comparison', () => {
  it('confirms the best start while preserving weather cautions', () => {
    expect(explorerComparisonSummary(compare(plan()))).toBe('Best time for this day');
    const caution = plan();
    caution.safety.tier = 'caution';
    expect(explorerComparisonSummary(compare(caution, caution))).toBe(
      'Best available time for this day',
    );
  });
  it('omits similar conditions and unavailable comparisons', () => {
    expect(explorerComparisonSummary(compare(plan(start + 3600000)))).toBeNull();
    expect(explorerComparisonSummary(compare(null))).toBeNull();
  });
  it('keeps only concise differences while preserving the full comparison reference', () => {
    const selected = plan(start + 3600000);
    selected.physicalConditions.meanTemperatureC = 23;
    const comparison = compare(selected);
    expect(explorerComparisonSummary(comparison)).toBe('3° warmer');
    expect(comparison.reference).toContain('vs recommended');
    expect(comparison.observations).toEqual(['3° warmer air']);
  });
});
