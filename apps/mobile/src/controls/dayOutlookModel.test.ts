import type { CalendarDayWindow, EvaluatedRunV3, StartCandidateAssessmentV3 } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import {
  accessibilityNudgeStart,
  buildDayRibbonSegments,
  dayOffsetForStart,
  gridStartsForDay,
  nearestGridStart,
  outlookAccessibilityText,
  preferredCandidateForDay,
  presentOutlookCandidate,
  ribbonTone,
  outlookRibbonState,
} from './dayOutlookModel';

const HOUR = 60 * 60_000;
const window: CalendarDayWindow = { start: 0, end: 24 * HOUR };

function candidate(
  startTime: number,
  tier: 'eligible' | 'caution' | 'ineligible' | null,
  fit: number | null,
  evaluable = true,
): StartCandidateAssessmentV3 {
  const plan =
    tier === null || fit === null
      ? null
      : ({
          durationSeconds: 3600,
          safety: { tier },
          physicalConditions: {
            meanTemperatureC: 18,
            radiationDoseJm2: 360_000,
            meanApparentAirflowMs: 3,
          },
          exposureSummary: { daylightFraction: 1 },
          conditionsFit: {
            value: fit,
            label: fit >= 0.7 ? 'favorable' : fit >= 0.45 ? 'mixed' : 'challenging',
            factors: {
              temperature: 0.04,
              radiation: 0.1,
              aerodynamicOpposition: 0.02,
              precipitation: 0,
            },
          },
        } as unknown as EvaluatedRunV3);
  return {
    startTime,
    finishTime: plan ? startTime + HOUR : null,
    evaluable,
    safety: tier ? { tier, policyVersion: 'test', reasons: [] } : null,
    conditionsFit: fit,
    plan,
    reasons: [],
  };
}

describe('day outlook grouping and ranking', () => {
  it('keeps Today and Tomorrow view membership independent of selection', () => {
    const tomorrow = { start: window.end, end: window.end + 24 * HOUR };
    expect(dayOffsetForStart(6 * HOUR, window, tomorrow)).toBe(0);
    expect(dayOffsetForStart(30 * HOUR, window, tomorrow)).toBe(1);
    expect(dayOffsetForStart(60 * HOUR, window, tomorrow)).toBeNull();
  });

  it('uses safety-first ranking for each calendar day', () => {
    const caution = candidate(6 * HOUR, 'caution', 0.99);
    const laterEligible = candidate(8 * HOUR, 'eligible', 0.805);
    const earlierEligibleTie = candidate(7 * HOUR, 'eligible', 0.8);
    expect(
      preferredCandidateForDay([caution, laterEligible, earlierEligibleTie], window)?.startTime,
    ).toBe(earlierEligibleTie.startTime);
  });
});

describe('day ribbon states', () => {
  it('distinguishes past, unavailable, caution, and ineligible candidates', () => {
    expect(outlookRibbonState(candidate(HOUR, 'eligible', 0.9), 2 * HOUR)).toBe('past');
    expect(outlookRibbonState(candidate(3 * HOUR, null, null, false), 2 * HOUR)).toBe(
      'unavailable',
    );
    expect(outlookRibbonState(candidate(4 * HOUR, 'caution', 0.8), 2 * HOUR)).toBe('caution');
    expect(outlookRibbonState(candidate(5 * HOUR, 'ineligible', 0.8), 2 * HOUR)).toBe('ineligible');
    expect(ribbonTone('caution')).toBe('mixed');
    expect(ribbonTone('ineligible')).toBe('challenging');
    expect(ribbonTone('past')).toBe('muted');
  });

  it('fills missing and elapsed half-hours with muted semantic states', () => {
    const presented = presentOutlookCandidate(
      candidate(3 * HOUR, 'eligible', 0.9),
      2 * HOUR,
      'celsius',
    );
    const segments = buildDayRibbonSegments(window, [presented], 2 * HOUR);
    expect(segments).toHaveLength(48);
    expect(segments[0].state).toBe('past');
    expect(segments[6]).toMatchObject({ state: 'favorable', candidateStart: 3 * HOUR });
    expect(segments[8]).toMatchObject({ state: 'unavailable', candidateStart: null });
  });
});

describe('day ribbon interaction and accessibility', () => {
  it('creates and selects a 30-minute grid within the viewed day', () => {
    const starts = gridStartsForDay(window, 6 * HOUR + 1, 8 * HOUR);
    expect(starts.slice(0, 3)).toEqual([6.5 * HOUR, 7 * HOUR, 7.5 * HOUR]);
    expect(nearestGridStart(starts, 7.2 * HOUR)).toBe(7 * HOUR);
    expect(starts[1] - starts[0]).toBe(30 * 60_000);
  });

  it('moves an off-grid immediate start onto the stable half-hour grid', () => {
    const selected = 6.25 * HOUR;
    expect(accessibilityNudgeStart(selected, 1, window, 6 * HOUR + 1, window.end)).toBe(6.5 * HOUR);
    expect(accessibilityNudgeStart(selected, -1, window, 6 * HOUR + 1, window.end)).toBeNull();
  });

  it('exposes condition, average temperature, and concern as text', () => {
    const presented = presentOutlookCandidate(
      candidate(7 * HOUR, 'eligible', 0.8),
      0,
      'fahrenheit',
    );
    expect(outlookAccessibilityText('Today', presented, '7:00 AM')).toBe(
      'Today run outlook. 7:00 AM. Favorable. 64° avg during run. Sun and warmth are the main tradeoff.',
    );
    expect(presented.facts).toBe('64° air · Low sun · Light wind');
  });
});
