import { describe, expect, it } from 'vitest';
import {
  MAX_PACE_SECONDS,
  MIN_PACE_SECONDS,
  PACE_STEP_SECONDS,
  nudgePaceSeconds,
} from './paceStepperModel';

describe('pace stepper model', () => {
  it('accumulates consecutive pace changes', () => {
    const first = nudgePaceSeconds(8 * 60 + 30, PACE_STEP_SECONDS);
    const second = nudgePaceSeconds(first, PACE_STEP_SECONDS);

    expect(second).toBe(8 * 60 + 40);
  });

  it('clamps pace changes to the supported range', () => {
    expect(nudgePaceSeconds(MIN_PACE_SECONDS, -PACE_STEP_SECONDS)).toBe(MIN_PACE_SECONDS);
    expect(nudgePaceSeconds(MAX_PACE_SECONDS, PACE_STEP_SECONDS)).toBe(MAX_PACE_SECONDS);
  });
});
