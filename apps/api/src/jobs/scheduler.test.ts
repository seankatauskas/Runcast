import { describe, expect, it, vi } from 'vitest';
import type { RecommendationV2 } from '@runcast/contracts';
import { PLANNING_ALGORITHM_VERSION_MANIFEST } from '@runcast/core';
import {
  forecastUsableForOccurrence,
  notificationCopy,
  publicationDeliveryWindow,
  qualifyingRevision,
  recommendationGridDecisionTime,
  revisionIsTimely,
  runWithSchedulerLock,
  type SchedulerLock,
} from './scheduler';
import type { PreparedRouteForecast } from '../planning/bundle';

function fakeLock(acquired: boolean): SchedulerLock & { release: ReturnType<typeof vi.fn> } {
  return {
    acquire: vi.fn(async () => acquired),
    release: vi.fn(async () => undefined),
  };
}

function recommendation(
  status: RecommendationV2['status'],
  winnerStart: number | null,
): RecommendationV2 {
  const winner =
    winnerStart === null
      ? null
      : {
          startTime: winnerStart,
          finishTime: winnerStart + 30 * 60_000,
          evaluable: true,
          safety: {
            tier: status === 'caution' ? ('caution' as const) : ('eligible' as const),
            policyVersion: 'fixture-v2',
            reasons: [],
          },
          conditionsFit: 0.8,
          plan: null,
          reasons: [],
        };
  return {
    schemaVersion: 2,
    status,
    winner,
    candidates: winner ? [winner] : [],
    evaluatedCandidateCount: winner ? 1 : 0,
    unevaluableCandidateCount: 0,
    reasons: [],
    versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
    evaluationId: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
  };
}

describe('scheduler advisory lock boundary', () => {
  it('does not execute work when another scheduler owns the lock', async () => {
    const lock = fakeLock(false);
    const work = vi.fn(async () => undefined);
    await expect(runWithSchedulerLock(lock, work)).resolves.toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it('releases the session lock after successful work and thrown work', async () => {
    const successful = fakeLock(true);
    await expect(runWithSchedulerLock(successful, async () => undefined)).resolves.toBe(true);
    expect(successful.release).toHaveBeenCalledOnce();

    const failed = fakeLock(true);
    await expect(
      runWithSchedulerLock(failed, async () => {
        throw new Error('provider failed');
      }),
    ).rejects.toThrow('provider failed');
    expect(failed.release).toHaveBeenCalledOnce();
  });
});

describe('V2 publication status and timing', () => {
  const windowStart = Date.UTC(2026, 6, 18, 12);

  it('uses a winner start for recommended and caution delivery timing', () => {
    const winnerStart = windowStart + 30 * 60_000;
    for (const status of ['recommended', 'caution'] as const) {
      expect(
        publicationDeliveryWindow({
          recommendation: recommendation(status, winnerStart),
          windowStart,
          leadMinutes: 60,
        }),
      ).toEqual({ opensAt: winnerStart - 60 * 60_000, closesAt: winnerStart });
    }
    expect(
      notificationCopy({
        routeName: 'Lakefront',
        timezone: 'UTC',
        recommendation: recommendation('caution', winnerStart),
      })?.title,
    ).toBe('Caution for Lakefront');
  });

  it('delivers no-suitable relative to window start and never publishes unavailable', () => {
    expect(
      publicationDeliveryWindow({
        recommendation: recommendation('no-suitable-window', null),
        windowStart,
        leadMinutes: 30,
      }),
    ).toEqual({ opensAt: windowStart - 30 * 60_000, closesAt: windowStart });
    expect(
      notificationCopy({
        routeName: 'Lakefront',
        timezone: 'UTC',
        recommendation: recommendation('no-suitable-window', null),
      })?.title,
    ).toBe('No suitable start window');
    expect(
      publicationDeliveryWindow({
        recommendation: recommendation('unavailable', null),
        windowStart,
        leadMinutes: 60,
      }),
    ).toBeNull();
    expect(
      notificationCopy({
        routeName: 'Lakefront',
        timezone: 'UTC',
        recommendation: recommendation('unavailable', null),
      }),
    ).toBeNull();
  });
});

describe('watch revision policy', () => {
  const start = Date.UTC(2026, 7, 16, 12);

  it.each([
    ['30-minute move', recommendation('recommended', start + 30 * 60_000), 'updated-start'],
    ['start appears', recommendation('recommended', start), 'updated-start'],
    ['start disappears', recommendation('no-suitable-window', null), 'conditions-changed'],
    ['recommended worsens', recommendation('caution', start), 'conditions-changed'],
  ])('qualifies %s', (_label, next, expected) => {
    const previous =
      _label === 'start appears'
        ? { status: 'no-suitable-window' as const, recommendedStart: null }
        : { status: 'recommended' as const, recommendedStart: start };
    expect(qualifyingRevision({ previous, next })).toBe(expected);
  });

  it.each([
    ['15-minute move', recommendation('recommended', start + 15 * 60_000)],
    ['same-start improvement', recommendation('recommended', start)],
    ['unavailable retry', recommendation('unavailable', null)],
  ])('does not qualify %s', (_label, next) => {
    expect(
      qualifyingRevision({
        previous: { status: 'caution', recommendedStart: start },
        next,
      }),
    ).toBeNull();
  });

  it('includes the final pass 15 minutes before the original reference', () => {
    expect(
      revisionIsTimely({ now: start - 15 * 60_000, originalStart: start, windowStart: start }),
    ).toBe(true);
    expect(
      revisionIsTimely({ now: start - 15 * 60_000 + 1, originalStart: start, windowStart: start }),
    ).toBe(false);
  });

  it('keeps cron-second lateness on the occurrence quarter-hour grid', () => {
    expect(recommendationGridDecisionTime(start + 3_000, start)).toBe(start);
    expect(recommendationGridDecisionTime(start - 1, start)).toBe(start - 15 * 60_000);
  });
});

describe('scheduler forecast freshness', () => {
  const now = Date.UTC(2026, 7, 16, 12);
  const windowStart = now + 60 * 60_000;
  const windowEnd = windowStart + 60 * 60_000;
  const preparedForecast = {
    forecast: {} as PreparedRouteForecast['forecast'],
    timezone: 'UTC',
    fetchedAt: now,
    validFrom: now,
    validUntil: windowEnd,
  } satisfies PreparedRouteForecast;

  it('requires freshness and forecast overlap with the occurrence window', () => {
    expect(forecastUsableForOccurrence({ preparedForecast, windowStart, windowEnd, now })).toBe(
      true,
    );
    expect(
      forecastUsableForOccurrence({
        preparedForecast: { ...preparedForecast, fetchedAt: now - 30 * 60_000 - 1 },
        windowStart,
        windowEnd,
        now,
      }),
    ).toBe(false);
    expect(
      forecastUsableForOccurrence({
        preparedForecast: { ...preparedForecast, validUntil: windowStart - 1 },
        windowStart,
        windowEnd,
        now,
      }),
    ).toBe(false);
    expect(
      forecastUsableForOccurrence({
        preparedForecast: null,
        windowStart,
        windowEnd,
        now,
      }),
    ).toBe(false);
  });
});
