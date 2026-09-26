import { describe, expect, it } from 'vitest';
import { gradeSpeedFactor, MAX_SPEED_FACTOR, MIN_SPEED_FACTOR } from './gap';

describe('gradeSpeedFactor', () => {
  it('is exactly 1 on flat ground', () => {
    expect(gradeSpeedFactor(0)).toBe(1);
  });

  it('slows the runner uphill, monotonically with grade', () => {
    let prev = 1;
    for (const g of [0.02, 0.05, 0.1, 0.15, 0.2, 0.3]) {
      const f = gradeSpeedFactor(g);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });

  it('matches the rule of thumb: ~5% grade costs roughly a quarter of speed', () => {
    const f = gradeSpeedFactor(0.05);
    expect(f).toBeGreaterThan(0.7);
    expect(f).toBeLessThan(0.85);
  });

  it('gives a mild, capped speedup on gentle downhills', () => {
    const f = gradeSpeedFactor(-0.03);
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThanOrEqual(MAX_SPEED_FACTOR);
    // Steep downhill hits the braking cap, not Minetti's metabolic ceiling.
    expect(gradeSpeedFactor(-0.12)).toBe(MAX_SPEED_FACTOR);
  });

  it('uphill + downhill never nets out faster than flat', () => {
    // Equal time-weighted legs: time per meter is 1/f, so the round trip
    // over ±g takes (1/f(g) + 1/f(−g))/2 ≥ 1 per flat meter.
    for (const g of [0.02, 0.05, 0.1]) {
      const roundTrip = (1 / gradeSpeedFactor(g) + 1 / gradeSpeedFactor(-g)) / 2;
      expect(roundTrip).toBeGreaterThan(1);
    }
  });

  it('clamps extreme grades instead of extrapolating the polynomial', () => {
    expect(gradeSpeedFactor(0.9)).toBe(gradeSpeedFactor(0.3));
    expect(gradeSpeedFactor(-0.9)).toBe(gradeSpeedFactor(-0.3));
    expect(gradeSpeedFactor(0.3)).toBeGreaterThanOrEqual(MIN_SPEED_FACTOR);
  });
});
