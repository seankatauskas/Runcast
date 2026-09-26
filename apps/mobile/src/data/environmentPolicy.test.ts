import { describe, expect, it } from 'vitest';
import { resolveClientCanopyModelMode } from './environmentPolicy';

describe('route weather acquisition policy', () => {
  it('defaults the launched demo canopy model to active and preserves its kill switch', () => {
    expect(resolveClientCanopyModelMode(undefined)).toBe('active');
    expect(resolveClientCanopyModelMode('unexpected')).toBe('off');
    expect(resolveClientCanopyModelMode('off')).toBe('off');
    expect(resolveClientCanopyModelMode('shadow')).toBe('shadow');
    expect(resolveClientCanopyModelMode('active')).toBe('active');
  });
});
