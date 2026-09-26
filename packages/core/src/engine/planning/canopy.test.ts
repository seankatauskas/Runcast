import { describe, expect, it } from 'vitest';
import { adjustRadiationForCanopy, reverseCanopyEvidence, seasonalLeafFactor } from './canopy';
import type { CanopyEvidenceProfile } from './types';

describe('canopy radiation model', () => {
  it('retains diffuse radiation and never exceeds open sky', () => {
    const result = adjustRadiationForCanopy({
      shortwaveWm2: 800,
      directNormalWm2: 900,
      diffuseWm2: 200,
      canopyPct: 80,
      standardErrorPct: 5,
      latitude: 40,
      at: Date.UTC(2026, 7, 15, 17),
    });
    expect(result.adjustedShortwaveWm2).toBeGreaterThanOrEqual(200);
    expect(result.adjustedShortwaveWm2).toBeLessThan(800);
    expect(result.adjustedDirectNormalWm2).toBeLessThan(900);
  });

  it('makes missing and zero canopy exactly open sky', () => {
    for (const sample of [
      { canopyPct: null, standardErrorPct: null },
      { canopyPct: 0, standardErrorPct: 0 },
    ]) {
      const result = adjustRadiationForCanopy({
        shortwaveWm2: 700,
        directNormalWm2: 800,
        diffuseWm2: 150,
        ...sample,
        latitude: 41,
        at: Date.UTC(2026, 6, 1),
      });
      expect(result.adjustedShortwaveWm2).toBe(700);
      expect(result.adjustedDirectNormalWm2).toBe(800);
    }
  });

  it('uses uncertainty conservatively and attenuates more in summer', () => {
    const base = {
      shortwaveWm2: 700,
      directNormalWm2: 800,
      diffuseWm2: 150,
      canopyPct: 70,
      latitude: 45,
    };
    const certain = adjustRadiationForCanopy({
      ...base,
      standardErrorPct: 2,
      at: Date.UTC(2026, 6, 15),
    });
    const uncertain = adjustRadiationForCanopy({
      ...base,
      standardErrorPct: 30,
      at: Date.UTC(2026, 6, 15),
    });
    const winter = adjustRadiationForCanopy({
      ...base,
      standardErrorPct: 2,
      at: Date.UTC(2026, 0, 15),
    });
    expect(uncertain.adjustedShortwaveWm2).toBeGreaterThan(certain.adjustedShortwaveWm2);
    expect(winter.adjustedShortwaveWm2).toBeGreaterThan(certain.adjustedShortwaveWm2);
    expect(seasonalLeafFactor(24, Date.UTC(2026, 0, 15))).toBe(1);
  });

  it('preserves distance/value alignment when reversed', () => {
    const profile: CanopyEvidenceProfile = {
      schemaVersion: 3,
      routeDistanceM: [0, 30, 70],
      canopyPct: [10, 20, 30],
      standardErrorPct: [1, 2, 3],
      provider: 'fixture',
      region: 'conus',
      datasetYear: 2025,
      datasetVersion: 'v2025-6',
      sourceResolutionM: 30,
      acquiredAt: 1,
      coordinateHash: 'hash',
      completeness: 'complete',
      reasons: [],
    };
    expect(reverseCanopyEvidence(profile, 70)).toMatchObject({
      routeDistanceM: [0, 40, 70],
      canopyPct: [30, 20, 10],
      standardErrorPct: [3, 2, 1],
    });
  });
});
