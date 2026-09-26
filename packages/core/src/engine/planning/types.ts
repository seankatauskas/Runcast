import type { LatLon } from '../types';

export type ReasonCode =
  | 'route.duplicate-point-removed'
  | 'route.elevation-absent'
  | 'route.elevation-partial'
  | 'route.elevation-legacy-unknown'
  | 'route.multiple-parts'
  | 'route.invalid-coordinate'
  | 'route.malformed-xml'
  | 'route.payload-too-large'
  | 'route.point-limit-exceeded'
  | 'weather.missing-critical-field'
  | 'weather.invalid-field'
  | 'weather.outside-validity'
  | 'weather.stale-within-validity'
  | 'coverage.unknown'
  | 'coverage.incomplete'
  | 'canopy.unavailable'
  | 'canopy.partial'
  | 'canopy.unsupported-region'
  | 'timing.flat-fallback'
  | 'safety.thunderstorm'
  | 'safety.heavy-rain'
  | 'safety.extreme-heat'
  | 'safety.high-wind'
  | 'recommendation.before-actionable-bound'
  | 'recommendation.finish-outside-validity'
  | 'recommendation.input-unavailable'
  | 'compatibility.reader-unsupported'
  | (string & {});

export type ElevationStatus = 'complete' | 'partial' | 'absent' | 'legacy-unknown';

export interface PlanningRoutePoint extends LatLon {
  elevationM: number | null;
}

export interface RouteQuality {
  schemaVersion: 2;
  trackCount: number;
  trackSegmentCount: number;
  routeCount: number;
  invalidPointCount: number;
  duplicatePointCount: number;
  missingElevationCount: number;
  elevationStatus: ElevationStatus;
  reasons: ReasonCode[];
}

export interface PlanningRoute {
  schemaVersion: 2;
  id: string;
  name: string;
  /** Serialized route schema V2 accepts exactly one continuous part. */
  part: { points: PlanningRoutePoint[] };
  cumulativeDistanceM: number[];
  totalDistanceM: number;
  quality: RouteQuality;
}

export type TemporalSemantics =
  'instant' | 'interval-mean' | 'interval-sum' | 'interval-max' | 'categorical' | 'probability';

export type ForecastVariable =
  | 'temperatureC'
  | 'feelsLikeC'
  | 'humidityPct'
  | 'windSpeedMs'
  | 'windDirectionFromDeg'
  | 'gustMs'
  | 'cloudCoverPct'
  | 'precipitationProbabilityPct'
  | 'precipitationMm'
  | 'weatherCode'
  | 'shortwaveRadiationWm2'
  | 'directNormalRadiationWm2'
  | 'diffuseRadiationWm2';

export interface ForecastVariableMetadata {
  semantics: TemporalSemantics;
  unit: string;
  validRange: readonly [number, number];
  required: boolean;
}

export interface NormalizedForecastSeries {
  time: number[];
  values: Record<ForecastVariable, Array<number | null>>;
}

export interface NormalizedRouteForecast {
  schemaVersion: 2;
  normalizationVersion: string;
  provider: string;
  providerModel: string | null;
  providerRun: string | null;
  fetchId: string;
  fetchedAt: number;
  validFrom: number;
  validUntil: number;
  requestedCoordinates: LatLon[];
  returnedCoordinates: LatLon[];
  variables: Record<ForecastVariable, ForecastVariableMetadata>;
  anchors: Array<LatLon & { routeDistanceM: number; hourly: NormalizedForecastSeries }>;
  missingCounts: Record<ForecastVariable, number>;
  contentHash: string;
  reasons: ReasonCode[];
}

export type WoodlandEvidenceValue = 'mapped-woodland' | 'no-mapped-woodland' | 'unknown';

export interface WoodlandEvidenceProfile {
  schemaVersion: 2;
  values: WoodlandEvidenceValue[];
  resolutionM: number;
  source: string;
  fetchedAt: number | null;
  parserVersion: string;
  completeness: 'complete' | 'partial' | 'unknown';
  confidence: number | null;
  reasons: ReasonCode[];
}

export type CanopyRegion = 'conus' | 'seak' | 'hawaii' | 'prusvi' | 'unsupported';
export type CanopyModelMode = 'off' | 'shadow' | 'active';

/** Numeric USDA canopy evidence sampled along a route at source resolution. */
export interface CanopyEvidenceProfile {
  schemaVersion: 3;
  routeDistanceM: number[];
  canopyPct: Array<number | null>;
  standardErrorPct: Array<number | null>;
  provider: string;
  region: CanopyRegion;
  datasetYear: 2025;
  datasetVersion: 'v2025-6';
  sourceResolutionM: 30;
  acquiredAt: number | null;
  coordinateHash: string;
  completeness: 'complete' | 'partial' | 'unavailable';
  reasons: ReasonCode[];
}

export type SafetyTier = 'eligible' | 'caution' | 'ineligible';

export interface SafetyAssessment {
  tier: SafetyTier;
  policyVersion: string;
  reasons: ReasonCode[];
}

export interface PhysicalExposureSummary {
  meanTemperatureC: number;
  radiationDoseJm2: number;
  directNormalRadiationDoseJm2: number;
  diffuseRadiationDoseJm2: number;
  precipitationAmountMm: number;
  meanApparentAirflowMs: number;
  meanAerodynamicOpposition: number;
  peaks: {
    feelsLikeC: number;
    gustMs: number;
    precipitationRateMmH: number;
    precipitationProbabilityPct: number;
  };
}

export interface CanopyPhysicalExposureSummary extends PhysicalExposureSummary {
  openSkyRadiationDoseJm2: number;
  canopyAdjustedRadiationDoseJm2: number;
  openSkyDirectNormalRadiationDoseJm2: number;
  canopyAdjustedDirectNormalRadiationDoseJm2: number;
}

export interface RouteEnvironmentProfile {
  geometricSolarElevationDeg: { minimum: number; maximum: number };
  apparentSolarElevationDeg: { minimum: number; maximum: number };
  daylightFraction: number;
  mappedWoodlandFraction: number | null;
  coverageCompleteness: WoodlandEvidenceProfile['completeness'];
}

export interface CanopyRouteEnvironmentProfile extends RouteEnvironmentProfile {
  canopyAvailableFraction: number;
  meanCanopyPct: number | null;
  meanBlockedDirectFraction: number;
  canopyCompleteness: CanopyEvidenceProfile['completeness'];
}

export interface ConditionsSuitabilityAssessment {
  value: number;
  label: 'favorable' | 'mixed' | 'challenging';
  version: string;
  factors: Record<string, number>;
}

export interface EvaluatedRun {
  schemaVersion: 2;
  routeId: string;
  startTime: number;
  finishTime: number;
  durationSeconds: number;
  timingQuality: 'grade-adjusted' | 'flat-fallback';
  paceModelVersion: string;
  safety: SafetyAssessment;
  physicalConditions: PhysicalExposureSummary;
  exposureSummary: RouteEnvironmentProfile;
  conditionsFit: ConditionsSuitabilityAssessment;
  evaluationId: string;
  reasons: ReasonCode[];
}

export interface StartCandidateAssessment {
  startTime: number;
  finishTime: number | null;
  evaluable: boolean;
  safety: SafetyAssessment | null;
  conditionsFit: number | null;
  plan: EvaluatedRun | null;
  reasons: ReasonCode[];
}

export interface EvaluatedRunV3 extends Omit<
  EvaluatedRun,
  'schemaVersion' | 'physicalConditions' | 'exposureSummary'
> {
  schemaVersion: 3;
  canopyModelMode: CanopyModelMode;
  physicalConditions: CanopyPhysicalExposureSummary;
  exposureSummary: CanopyRouteEnvironmentProfile;
}

export interface StartCandidateAssessmentV3 extends Omit<StartCandidateAssessment, 'plan'> {
  plan: EvaluatedRunV3 | null;
}

export type StartRecommendationStatus =
  'recommended' | 'caution' | 'no-suitable-window' | 'unavailable';

export interface StartRecommendation {
  schemaVersion: 2;
  status: StartRecommendationStatus;
  winner: StartCandidateAssessment | null;
  candidates: StartCandidateAssessment[];
  evaluatedCandidateCount: number;
  unevaluableCandidateCount: number;
  reasons: ReasonCode[];
  versions: PlanningAlgorithmVersionManifest;
  evaluationId: string;
  inputHash: string;
}

export interface PlanningAlgorithmVersionManifest {
  route: string;
  timing: string;
  weatherNormalizer: string;
  weatherSampler: string;
  exposure: string;
  wind: string;
  physicalConditions: string;
  preference: string;
  safety: string;
  recommendation: string;
  explanation: string;
  build: string;
}

export interface PlanningAlgorithmVersionManifestV3 extends PlanningAlgorithmVersionManifest {
  canopy: string;
}

export interface StartRecommendationV3 extends Omit<
  StartRecommendation,
  'schemaVersion' | 'winner' | 'candidates' | 'versions'
> {
  schemaVersion: 3;
  winner: StartCandidateAssessmentV3 | null;
  candidates: StartCandidateAssessmentV3[];
  versions: PlanningAlgorithmVersionManifestV3;
}
