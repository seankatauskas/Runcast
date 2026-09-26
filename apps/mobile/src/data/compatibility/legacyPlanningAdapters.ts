import { type CoverageMask, type WoodlandEvidenceProfile } from '@runcast/core';

export function woodlandEvidenceForLegacyPresentation(
  woodlandEvidence: WoodlandEvidenceProfile,
): CoverageMask {
  return {
    resolution: woodlandEvidence.resolutionM,
    values: woodlandEvidence.values.map((value) =>
      value === 'mapped-woodland' ? 'tree' : value === 'no-mapped-woodland' ? 'open' : 'unknown',
    ),
  };
}

export function legacyCoverageAsWoodlandEvidence(
  legacyCoverage: CoverageMask,
  source: string,
): WoodlandEvidenceProfile {
  const hasUnknown = legacyCoverage.values.includes('unknown');
  return {
    schemaVersion: 2,
    values: legacyCoverage.values.map((value) =>
      value === 'tree' ? 'mapped-woodland' : value === 'open' ? 'no-mapped-woodland' : 'unknown',
    ),
    resolutionM: legacyCoverage.resolution,
    source,
    fetchedAt: null,
    parserVersion: 'legacy-mask-adapter-v1',
    completeness: hasUnknown ? 'unknown' : 'partial',
    confidence: null,
    reasons: hasUnknown ? ['coverage.unknown'] : ['coverage.incomplete'],
  };
}
