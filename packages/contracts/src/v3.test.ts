import { describe, expect, it } from 'vitest';
import { canopyEvidenceV3Schema, physicalConditionsV3Schema } from './v3';

const canopy = {
  schemaVersion: 3 as const,
  routeDistanceM: [0, 30, 60],
  canopyPct: [10, null, 80],
  standardErrorPct: [1, null, 4],
  provider: 'usda-fs-science-tcc',
  region: 'conus' as const,
  datasetYear: 2025 as const,
  datasetVersion: 'v2025-6' as const,
  sourceResolutionM: 30 as const,
  acquiredAt: 1,
  coordinateHash: 'geometry',
  completeness: 'partial' as const,
  reasons: ['canopy.partial'],
};

describe('V3 canopy contracts', () => {
  it('accepts aligned nullable evidence and rejects stale/misaligned arrays', () => {
    expect(canopyEvidenceV3Schema.parse(canopy)).toEqual(canopy);
    expect(() => canopyEvidenceV3Schema.parse({ ...canopy, standardErrorPct: [1, null] })).toThrow(
      /align/,
    );
    expect(() => canopyEvidenceV3Schema.parse({ ...canopy, standardErrorPct: [1, 2, 4] })).toThrow(
      /availability/,
    );
    expect(() => canopyEvidenceV3Schema.parse({ ...canopy, routeDistanceM: [0, 30, 29] })).toThrow(
      /strictly increase/,
    );
  });

  it('enforces adjusted radiation as a conservative subset of open sky', () => {
    const physical = {
      meanTemperatureC: 24,
      radiationDoseJm2: 10_000,
      directNormalRadiationDoseJm2: 8_000,
      diffuseRadiationDoseJm2: 2_000,
      openSkyRadiationDoseJm2: 12_000,
      canopyAdjustedRadiationDoseJm2: 10_000,
      openSkyDirectNormalRadiationDoseJm2: 9_000,
      canopyAdjustedDirectNormalRadiationDoseJm2: 8_000,
      precipitationAmountMm: 0,
      meanApparentAirflowMs: 2,
      meanAerodynamicOpposition: 0,
      peaks: {
        feelsLikeC: 25,
        gustMs: 3,
        precipitationRateMmH: 0,
        precipitationProbabilityPct: 0,
      },
    };
    expect(physicalConditionsV3Schema.parse(physical)).toEqual(physical);
    expect(() =>
      physicalConditionsV3Schema.parse({
        ...physical,
        canopyAdjustedRadiationDoseJm2: 13_000,
      }),
    ).toThrow(/exceeds open sky/);
  });
});
