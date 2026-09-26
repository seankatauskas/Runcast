import { planningBundleV3Schema, type PlanningBundleV3 } from '@runcast/contracts';
import { contentIdentity } from '@runcast/core';

export type PlanningBundleValidationCode =
  'bundle.invalid-json' | 'bundle.schema-mismatch' | 'bundle.hash-mismatch';

export class PlanningBundleValidationError extends Error {
  constructor(
    public readonly code: PlanningBundleValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlanningBundleValidationError';
  }
}

function assertHash(label: string, expected: string, value: unknown): void {
  if (contentIdentity(value) !== expected) {
    throw new PlanningBundleValidationError(
      'bundle.hash-mismatch',
      `${label} content identity does not match`,
    );
  }
}

/** Strictly parse and verify every nested identity before a bundle reaches storage. */
export type PlanningBundle = PlanningBundleV3;

export function parseAndVerifyPlanningBundle(raw: string | unknown): PlanningBundle {
  let decoded: unknown = raw;
  if (typeof raw === 'string') {
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new PlanningBundleValidationError('bundle.invalid-json', 'Bundle is not valid JSON');
    }
  }
  const parsed = planningBundleV3Schema.safeParse(decoded);
  if (!parsed.success)
    throw new PlanningBundleValidationError(
      'bundle.schema-mismatch',
      'Bundle does not match reader schema 3',
    );
  const bundle = parsed.data;
  assertHash('route', bundle.route.contentHash, { data: bundle.route.data });
  assertHash('environment', bundle.environment.contentHash, {
    coverage: bundle.environment.coverage,
    canopy: bundle.environment.canopy,
  });
  const { contentHash: forecastIdentity, ...forecastBody } = bundle.forecast.data;
  assertHash('normalized forecast', forecastIdentity, forecastBody);
  assertHash('forecast', bundle.forecast.contentHash, { data: bundle.forecast.data });
  if (bundle.safetyContext) {
    assertHash('safety context', bundle.safetyContext.contentHash, {
      data: bundle.safetyContext.data,
    });
  }
  const { contentHash: manifestIdentity, ...manifestBody } = bundle.manifest;
  assertHash('manifest', manifestIdentity, manifestBody);
  assertHash('bundle', bundle.manifest.bundleId, {
    route: bundle.route.contentHash,
    environment: bundle.environment.contentHash,
    forecast: bundle.forecast.contentHash,
    safetyContext: bundle.safetyContext?.contentHash ?? null,
    versions: bundle.manifest.versions,
  });
  return bundle;
}

export interface CachedPlanningBundle {
  userId: string;
  routeId: string;
  etag: string;
  body: string;
  bundle: PlanningBundle;
  installedAt: number;
}

export function planningBundleIsEnvironmentallyValid(
  cached: CachedPlanningBundle,
  now = Date.now(),
): boolean {
  const validFrom = Date.parse(cached.bundle.manifest.validFrom);
  const validUntil = Date.parse(cached.bundle.manifest.validUntil);
  return now >= validFrom && now <= validUntil;
}
