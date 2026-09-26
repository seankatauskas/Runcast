import type { EvaluatedRunV3, StartRecommendationV3 } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import {
  planningSurfaceMode,
  planningUnavailableMessage,
  startRecommendationPresentation,
} from './startRecommendationPresentation';

function recommendation(status: StartRecommendationV3['status'], reasons: string[] = []) {
  return { status, reasons, winner: null } as StartRecommendationV3;
}

describe('start recommendation presentation', () => {
  it('presents evaluated conditions and distinguishes loading from unavailable', () => {
    expect(
      planningSurfaceMode({
        hasEvaluatedRun: true,
        weatherStatus: 'ready',
        syncState: 'not-modified',
        environmentExpired: false,
      }),
    ).toBe('ready');
    expect(
      planningSurfaceMode({
        hasEvaluatedRun: false,
        weatherStatus: 'loading',
        syncState: null,
        environmentExpired: false,
      }),
    ).toBe('loading');
    expect(
      planningSurfaceMode({
        hasEvaluatedRun: false,
        weatherStatus: 'ready',
        syncState: 'modified',
        environmentExpired: false,
      }),
    ).toBe('unavailable');
  });

  it('presents terminal V2 unavailability instead of an indefinite loading state', () => {
    expect(
      planningUnavailableMessage({
        weatherStatus: 'ready',
        syncState: 'modified',
        environmentExpired: false,
        reasons: ['weather.missing-critical-field'],
      }),
    ).toBe('A required forecast value is missing.');
    expect(
      planningUnavailableMessage({
        weatherStatus: 'ready',
        syncState: 'preparing',
        environmentExpired: false,
        reasons: [],
      }),
    ).toBe('The route forecast is still being prepared.');
  });

  it.each([
    ['recommended', 'BEST TIME TO RUN'],
    ['caution', 'BEST AVAILABLE TIME'],
    ['no-suitable-window', 'NO SUITABLE WINDOW'],
    ['unavailable', 'UNAVAILABLE'],
  ] as const)('renders structured %s state', (status, label) => {
    expect(
      startRecommendationPresentation({
        recommendation: recommendation(status, ['safety.high-wind']),
        unavailableReasons: [],
        syncState: null,
        environmentExpired: false,
      }),
    ).toMatchObject({ status, label, reasons: [{ code: 'safety.high-wind' }] });
  });

  it('distinguishes preparation, update, and expired unavailability', () => {
    expect(
      startRecommendationPresentation({
        recommendation: null,
        unavailableReasons: ['bundle.preparing'],
        syncState: 'preparing',
        environmentExpired: false,
      }).label,
    ).toBe('PREPARING');
    expect(
      startRecommendationPresentation({
        recommendation: null,
        unavailableReasons: ['compatibility.reader-unsupported'],
        syncState: 'update-required',
        environmentExpired: false,
      }).label,
    ).toBe('UPDATE REQUIRED');
    expect(
      startRecommendationPresentation({
        recommendation: null,
        unavailableReasons: ['weather.outside-validity'],
        syncState: 'unavailable',
        environmentExpired: true,
      }).detail,
    ).toContain('Route geometry and timing');
  });

  it('describes a selected start with runner-facing run conditions', () => {
    const plan = {
      durationSeconds: 3600,
      physicalConditions: {
        radiationDoseJm2: 1_080_000,
        meanApparentAirflowMs: 4,
      },
      exposureSummary: { daylightFraction: 1 },
      conditionsFit: {
        value: 0.8,
        label: 'favorable',
        factors: {
          temperature: 0.04,
          radiation: 0.08,
          aerodynamicOpposition: 0.04,
          precipitation: 0,
        },
      },
    } as unknown as EvaluatedRunV3;
    const result = startRecommendationPresentation({
      recommendation: {
        status: 'recommended',
        reasons: [],
        winner: { startTime: 1_000, plan },
      } as unknown as StartRecommendationV3,
      unavailableReasons: [],
      syncState: null,
      environmentExpired: false,
    });

    expect(result.detail).toBe('Favorable run conditions');
    expect(result.detail).not.toMatch(/comfort|radiation|apparent|aerodynamic/i);
  });
});
