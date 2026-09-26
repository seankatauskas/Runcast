import { z } from 'zod';
import {
  conditionsFitV2Schema,
  coverageEvidenceV2Schema,
  exposureSummaryV2Schema,
  normalizedWeatherFieldV2Schema,
  plannableRouteV2Schema,
  safetyAssessmentV2Schema,
} from './v2';

const finite = z.number().finite();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const reasonCode = z.string().min(1).max(160);

export const canopyRegionV3Schema = z.enum(['conus', 'seak', 'hawaii', 'prusvi', 'unsupported']);

export const canopyEvidenceV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    routeDistanceM: z.array(finite.nonnegative()).min(1).max(20_000),
    canopyPct: z.array(finite.min(0).max(100).nullable()).min(1).max(20_000),
    standardErrorPct: z.array(finite.nonnegative().max(100).nullable()).min(1).max(20_000),
    provider: z.string().min(1).max(100),
    region: canopyRegionV3Schema,
    datasetYear: z.literal(2025),
    datasetVersion: z.literal('v2025-6'),
    sourceResolutionM: z.literal(30),
    acquiredAt: finite.nullable(),
    coordinateHash: z.string().min(1).max(200),
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    reasons: z.array(reasonCode),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      profile.routeDistanceM.length !== profile.canopyPct.length ||
      profile.routeDistanceM.length !== profile.standardErrorPct.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'canopy arrays must align',
      });
    }
    if (profile.routeDistanceM[0] !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'canopy distance must start at zero' });
    }
    for (let index = 1; index < profile.routeDistanceM.length; index += 1) {
      if (profile.routeDistanceM[index] <= profile.routeDistanceM[index - 1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'canopy distances must strictly increase',
        });
        break;
      }
    }
    for (let index = 0; index < profile.routeDistanceM.length; index += 1) {
      if ((profile.canopyPct[index] === null) !== (profile.standardErrorPct[index] === null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'canopy and standard error availability must align',
        });
        break;
      }
    }
  });

export const physicalConditionsV3Schema = z
  .object({
    meanTemperatureC: finite,
    radiationDoseJm2: finite.nonnegative(),
    directNormalRadiationDoseJm2: finite.nonnegative(),
    diffuseRadiationDoseJm2: finite.nonnegative(),
    openSkyRadiationDoseJm2: finite.nonnegative(),
    canopyAdjustedRadiationDoseJm2: finite.nonnegative(),
    openSkyDirectNormalRadiationDoseJm2: finite.nonnegative(),
    canopyAdjustedDirectNormalRadiationDoseJm2: finite.nonnegative(),
    precipitationAmountMm: finite.nonnegative(),
    meanApparentAirflowMs: finite.nonnegative(),
    meanAerodynamicOpposition: finite,
    peaks: z
      .object({
        feelsLikeC: finite,
        gustMs: finite.nonnegative(),
        precipitationRateMmH: finite.nonnegative(),
        precipitationProbabilityPct: finite.min(0).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((physical, ctx) => {
    if (physical.canopyAdjustedRadiationDoseJm2 > physical.openSkyRadiationDoseJm2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'adjusted dose exceeds open sky' });
    }
    if (
      physical.canopyAdjustedDirectNormalRadiationDoseJm2 >
      physical.openSkyDirectNormalRadiationDoseJm2
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'adjusted DNI exceeds open sky' });
    }
  });

export const exposureSummaryV3Schema = exposureSummaryV2Schema
  .extend({
    canopyAvailableFraction: finite.min(0).max(1),
    meanCanopyPct: finite.min(0).max(100).nullable(),
    meanBlockedDirectFraction: finite.min(0).max(1),
    canopyCompleteness: z.enum(['complete', 'partial', 'unavailable']),
  })
  .strict();

export const runPlanV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    routeId: z.string().min(1).max(200),
    startTime: finite,
    finishTime: finite,
    durationSeconds: finite.positive(),
    timingQuality: z.enum(['grade-adjusted', 'flat-fallback']),
    paceModelVersion: z.string().min(1).max(100),
    canopyModelMode: z.enum(['off', 'shadow', 'active']),
    safety: safetyAssessmentV2Schema,
    physicalConditions: physicalConditionsV3Schema,
    exposureSummary: exposureSummaryV3Schema,
    conditionsFit: conditionsFitV2Schema,
    evaluationId: sha256,
    reasons: z.array(reasonCode),
  })
  .strict();

export const versionRegistryV3Schema = z
  .object({
    route: z.string(),
    timing: z.string(),
    weatherNormalizer: z.string(),
    weatherSampler: z.string(),
    exposure: z.string(),
    canopy: z.string(),
    wind: z.string(),
    physicalConditions: z.string(),
    preference: z.string(),
    safety: z.string(),
    recommendation: z.string(),
    explanation: z.string(),
    build: z.string(),
  })
  .strict();

export const candidateAssessmentV3Schema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      startTime: finite,
      finishTime: finite.nullable(),
      evaluable: z.boolean(),
      safety: safetyAssessmentV2Schema.nullable(),
      conditionsFit: finite.min(0).max(1).nullable(),
      plan: runPlanV3Schema.nullable(),
      reasons: z.array(reasonCode),
    })
    .strict(),
);

export const recommendationV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    status: z.enum(['recommended', 'caution', 'no-suitable-window', 'unavailable']),
    winner: candidateAssessmentV3Schema.nullable(),
    candidates: z.array(candidateAssessmentV3Schema),
    evaluatedCandidateCount: z.number().int().nonnegative(),
    unevaluableCandidateCount: z.number().int().nonnegative(),
    reasons: z.array(reasonCode),
    versions: versionRegistryV3Schema,
    evaluationId: sha256,
    inputHash: sha256,
  })
  .strict();

const bundleSection = z
  .object({ schemaVersion: z.number().int().positive(), contentHash: sha256 })
  .strict();

export const planningBundleV3Schema = z
  .object({
    manifest: bundleSection.extend({
      bundleSchemaVersion: z.literal(3),
      bundleId: sha256,
      generatedAt: z.string().datetime({ offset: true }),
      validFrom: z.string().datetime({ offset: true }),
      validUntil: z.string().datetime({ offset: true }),
      state: z.enum(['ready', 'stale-within-validity', 'degraded']),
      evaluatorBuild: z.string().min(1).max(200),
      canopyModelMode: z.enum(['off', 'shadow', 'active']),
      versions: versionRegistryV3Schema,
    }),
    route: bundleSection.extend({ data: plannableRouteV2Schema }),
    environment: bundleSection.extend({
      coverage: coverageEvidenceV2Schema,
      canopy: canopyEvidenceV3Schema,
    }),
    forecast: bundleSection.extend({ data: normalizedWeatherFieldV2Schema }),
    safetyContext: bundleSection.extend({ data: z.unknown() }).nullable(),
  })
  .strict();

export type CanopyRegionV3 = z.infer<typeof canopyRegionV3Schema>;
export type CanopyEvidenceV3 = z.infer<typeof canopyEvidenceV3Schema>;
export type PhysicalConditionsV3 = z.infer<typeof physicalConditionsV3Schema>;
export type RunPlanV3 = z.infer<typeof runPlanV3Schema>;
export type RecommendationV3 = z.infer<typeof recommendationV3Schema>;
export type VersionRegistryV3 = z.infer<typeof versionRegistryV3Schema>;
export type PlanningBundleV3 = z.infer<typeof planningBundleV3Schema>;
