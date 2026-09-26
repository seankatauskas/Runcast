import { describe, expect, it } from 'vitest';
import { runStartReducer, resolveRunStart, type RunStartSelection } from './runDisplayContext';
const now = Date.parse('2026-09-19T10:00:00Z');
const early = now + 3600_000;
const later = now + 7200_000;
const initial: RunStartSelection = { mode: 'recommended', selected: early, preview: null };

describe('shared run selection', () => {
  it('follows recommendations until an explicit choice, including changes from pace or forecast refresh', () => {
    expect(resolveRunStart(initial, later, now).startTime).toBe(later);
    const selected = runStartReducer(initial, { type: 'commit', start: early });
    expect(resolveRunStart(selected, later, now)).toEqual({
      startTime: early,
      committedStartTime: early,
    });
    // All surfaces read the same state; returning from Planner does not reset it.
    expect(resolveRunStart(selected, later + 3600_000, now).startTime).toBe(early);
  });
  it('previews without changing the committed run and restores it on cancellation', () => {
    const preview = runStartReducer(initial, { type: 'preview', start: early });
    expect(resolveRunStart(preview, later, now)).toEqual({
      startTime: early,
      committedStartTime: later,
    });
    const canceled = runStartReducer(preview, { type: 'preview', start: null });
    expect(resolveRunStart(canceled, later, now).startTime).toBe(later);
  });
  it('clears previews on commit and route changes, while a subsequent deep-link start wins', () => {
    const preview = runStartReducer(initial, { type: 'preview', start: later });
    const committed = runStartReducer(preview, { type: 'commit', start: later });
    expect(committed).toEqual({ mode: 'selected', selected: later, preview: null });
    const changedRoute = runStartReducer(committed, { type: 'route' });
    expect(resolveRunStart(changedRoute, early, now).startTime).toBe(early);
    const deepLink = runStartReducer(changedRoute, { type: 'commit', start: later });
    expect(resolveRunStart(deepLink, early, now).startTime).toBe(later);
  });
  it('handles missing forecasts without borrowing a different recommendation', () => {
    const selected = runStartReducer(initial, { type: 'commit', start: later });
    expect(resolveRunStart(selected, null, now).startTime).toBe(later);
    expect(resolveRunStart(initial, null, now).startTime).toBe(early);
  });
  it('drops elapsed previews and advances a past selection with the existing clock rules', () => {
    const preview = runStartReducer(initial, { type: 'preview', start: early });
    const tick = runStartReducer(preview, { type: 'clock', now: later });
    expect(tick.preview).toBeNull();
    expect(resolveRunStart(tick, null, later).startTime).toBeGreaterThanOrEqual(later);
  });
});
