import { z } from 'zod';

const finite = z.number().finite();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const reasonCodeSchema = z.string().min(1).max(160);
const latLonSchema = z
  .object({ lat: finite.min(-90).max(90), lon: finite.min(-180).max(180) })
  .strict();

export const routePointV2Schema = latLonSchema.extend({ elevationM: finite.nullable() }).strict();

export const routeQualityV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    trackCount: z.number().int().nonnegative(),
    trackSegmentCount: z.number().int().nonnegative(),
    routeCount: z.number().int().nonnegative(),
    invalidPointCount: z.number().int().nonnegative(),
    duplicatePointCount: z.number().int().nonnegative(),
    missingElevationCount: z.number().int().nonnegative(),
    elevationStatus: z.enum(['complete', 'partial', 'absent', 'legacy-unknown']),
    reasons: z.array(reasonCodeSchema),
  })
  .strict();

export const plannableRouteV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    part: z.object({ points: z.array(routePointV2Schema).min(2).max(20_000) }).strict(),
    cumulativeDistanceM: z.array(finite.nonnegative()).min(2).max(20_000),
    totalDistanceM: finite.positive(),
    quality: routeQualityV2Schema,
  })
  .strict()
  .superRefine((route, ctx) => {
    if (route.part.points.length !== route.cumulativeDistanceM.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'points and cumulative distance must align',
      });
    }
    if (route.cumulativeDistanceM[0] !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cumulative distance must start at zero',
      });
    }
    for (let i = 1; i < route.cumulativeDistanceM.length; i++) {
      if (route.cumulativeDistanceM[i] < route.cumulativeDistanceM[i - 1]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'cumulative distance must increase' });
        break;
      }
    }
  });

export const weatherVariableV2Schema = z.enum([
  'temperatureC',
  'feelsLikeC',
  'humidityPct',
  'windSpeedMs',
  'windDirectionFromDeg',
  'gustMs',
  'cloudCoverPct',
  'precipitationProbabilityPct',
  'precipitationMm',
  'weatherCode',
  'shortwaveRadiationWm2',
  'directNormalRadiationWm2',
  'diffuseRadiationWm2',
]);

const temporalSemanticsSchema = z.enum([
  'instant',
  'interval-mean',
  'interval-sum',
  'interval-max',
  'categorical',
  'probability',
]);

const weatherVariableMetadataV2Schema = z
  .object({
    semantics: temporalSemanticsSchema,
    unit: z.string().min(1).max(40),
    validRange: z.tuple([finite, finite]),
    required: z.boolean(),
  })
  .strict();

const weatherValueRecordSchema = z.record(
  weatherVariableV2Schema,
  z.array(finite.nullable()).min(2),
);

const weatherSeriesV2Schema = z
  .object({
    time: z.array(finite).min(2),
    values: weatherValueRecordSchema,
  })
  .strict()
  .superRefine((series, ctx) => {
    for (let i = 1; i < series.time.length; i++) {
      if (series.time[i] <= series.time[i - 1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'weather times must strictly increase',
        });
        break;
      }
    }
    for (const [variable, values] of Object.entries(series.values)) {
      if (values.length !== series.time.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${variable} must align with time` });
      }
    }
  });

export const normalizedWeatherFieldV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    normalizationVersion: z.string().min(1).max(100),
    provider: z.string().min(1).max(100),
    providerModel: z.string().max(200).nullable(),
    providerRun: z.string().max(200).nullable(),
    fetchId: z.string().min(1).max(200),
    fetchedAt: finite,
    validFrom: finite,
    validUntil: finite,
    requestedCoordinates: z.array(latLonSchema).min(1).max(50),
    returnedCoordinates: z.array(latLonSchema).min(1).max(50),
    variables: z.record(weatherVariableV2Schema, weatherVariableMetadataV2Schema),
    anchors: z
      .array(
        latLonSchema
          .extend({ routeDistanceM: finite.nonnegative(), hourly: weatherSeriesV2Schema })
          .strict(),
      )
      .min(1)
      .max(50),
    missingCounts: z.record(weatherVariableV2Schema, z.number().int().nonnegative()),
    contentHash: sha256,
    reasons: z.array(reasonCodeSchema),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.validUntil <= field.validFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'weather validity must be non-empty' });
    }
    if (field.requestedCoordinates.length !== field.returnedCoordinates.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'requested and returned locations must align',
      });
    }
  });

export const coverageEvidenceV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    values: z
      .array(z.enum(['mapped-woodland', 'no-mapped-woodland', 'unknown']))
      .min(1)
      .max(20_000),
    resolutionM: finite.positive(),
    source: z.string().min(1).max(100),
    fetchedAt: finite.nullable(),
    parserVersion: z.string().min(1).max(100),
    completeness: z.enum(['complete', 'partial', 'unknown']),
    confidence: finite.min(0).max(1).nullable(),
    reasons: z.array(reasonCodeSchema),
  })
  .strict();

export const safetyAssessmentV2Schema = z
  .object({
    tier: z.enum(['eligible', 'caution', 'ineligible']),
    policyVersion: z.string().min(1).max(100),
    reasons: z.array(reasonCodeSchema),
  })
  .strict();

export const physicalConditionsV2Schema = z
  .object({
    meanTemperatureC: finite,
    radiationDoseJm2: finite.nonnegative(),
    directNormalRadiationDoseJm2: finite.nonnegative(),
    diffuseRadiationDoseJm2: finite.nonnegative(),
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
  .strict();

export const exposureSummaryV2Schema = z
  .object({
    geometricSolarElevationDeg: z.object({ minimum: finite, maximum: finite }).strict(),
    apparentSolarElevationDeg: z.object({ minimum: finite, maximum: finite }).strict(),
    daylightFraction: finite.min(0).max(1),
    mappedWoodlandFraction: finite.min(0).max(1).nullable(),
    coverageCompleteness: z.enum(['complete', 'partial', 'unknown']),
  })
  .strict();

export const conditionsFitV2Schema = z
  .object({
    value: finite.min(0).max(1),
    label: z.enum(['favorable', 'mixed', 'challenging']),
    version: z.string().min(1).max(100),
    factors: z.record(z.string(), finite),
  })
  .strict();

export const runPlanV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    routeId: z.string().min(1).max(200),
    startTime: finite,
    finishTime: finite,
    durationSeconds: finite.positive(),
    timingQuality: z.enum(['grade-adjusted', 'flat-fallback']),
    paceModelVersion: z.string().min(1).max(100),
    safety: safetyAssessmentV2Schema,
    physicalConditions: physicalConditionsV2Schema,
    exposureSummary: exposureSummaryV2Schema,
    conditionsFit: conditionsFitV2Schema,
    evaluationId: sha256,
    reasons: z.array(reasonCodeSchema),
  })
  .strict();

export const versionRegistryV2Schema = z
  .object({
    route: z.string(),
    timing: z.string(),
    weatherNormalizer: z.string(),
    weatherSampler: z.string(),
    exposure: z.string(),
    wind: z.string(),
    physicalConditions: z.string(),
    preference: z.string(),
    safety: z.string(),
    recommendation: z.string(),
    explanation: z.string(),
    build: z.string(),
  })
  .strict();

export const candidateAssessmentV2Schema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      startTime: finite,
      finishTime: finite.nullable(),
      evaluable: z.boolean(),
      safety: safetyAssessmentV2Schema.nullable(),
      conditionsFit: finite.min(0).max(1).nullable(),
      plan: runPlanV2Schema.nullable(),
      reasons: z.array(reasonCodeSchema),
    })
    .strict(),
);

export const recommendationV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    status: z.enum(['recommended', 'caution', 'no-suitable-window', 'unavailable']),
    winner: candidateAssessmentV2Schema.nullable(),
    candidates: z.array(candidateAssessmentV2Schema),
    evaluatedCandidateCount: z.number().int().nonnegative(),
    unevaluableCandidateCount: z.number().int().nonnegative(),
    reasons: z.array(reasonCodeSchema),
    versions: versionRegistryV2Schema,
    evaluationId: sha256,
    inputHash: sha256,
  })
  .strict();

const bundleSectionSchema = z
  .object({ schemaVersion: z.number().int().positive(), contentHash: sha256 })
  .strict();

export const planningBundleV2Schema = z
  .object({
    manifest: bundleSectionSchema.extend({
      bundleSchemaVersion: z.literal(2),
      bundleId: sha256,
      generatedAt: z.string().datetime({ offset: true }),
      validFrom: z.string().datetime({ offset: true }),
      validUntil: z.string().datetime({ offset: true }),
      state: z.enum(['ready', 'stale-within-validity', 'degraded']),
      evaluatorBuild: z.string().min(1).max(200),
      versions: versionRegistryV2Schema,
    }),
    route: bundleSectionSchema.extend({ data: plannableRouteV2Schema }),
    environment: bundleSectionSchema.extend({ coverage: coverageEvidenceV2Schema }),
    forecast: bundleSectionSchema.extend({ data: normalizedWeatherFieldV2Schema }),
    safetyContext: bundleSectionSchema.extend({ data: z.unknown() }).nullable(),
  })
  .strict();

export type PlannableRouteV2 = z.infer<typeof plannableRouteV2Schema>;
export type NormalizedWeatherFieldV2 = z.infer<typeof normalizedWeatherFieldV2Schema>;
export type CoverageEvidenceV2 = z.infer<typeof coverageEvidenceV2Schema>;
export type RunPlanV2 = z.infer<typeof runPlanV2Schema>;
export type RecommendationV2 = z.infer<typeof recommendationV2Schema>;
export type PlanningBundleV2 = z.infer<typeof planningBundleV2Schema>;
