import type { PlanningAlgorithmVersionManifest, PlanningAlgorithmVersionManifestV3 } from './types';

export const PLANNING_ROUTE_PARSER_MODEL_VERSION = 'gpx-saxes-v2';
export const GRADE_ADJUSTED_PACE_MODEL_VERSION = 'minetti-clamped-v1';
export const FLAT_PACE_MODEL_VERSION = 'flat-v1';
export const ROUTE_TIMING_MODEL_VERSION = 'minetti-clamped-v1+flat-v1';
export const NORMALIZED_ROUTE_FORECAST_MODEL_VERSION = 'open-meteo-normalizer-v2';
export const ROUTE_FORECAST_SAMPLING_MODEL_VERSION = 'variable-semantics-v2';
export const WOODLAND_EVIDENCE_PARSER_MODEL_VERSION = 'osm-multipolygon-v2';
export const ROUTE_ENVIRONMENT_MODEL_VERSION = 'radiation-woodland-evidence-v2';
export const CANOPY_MODEL_VERSION = 'usda-science-tcc-lower-bound-v3';
export const RUNNER_RELATIVE_WIND_MODEL_VERSION = 'runner-relative-wind-v2';
export const PHYSICAL_EXPOSURE_MODEL_VERSION = 'time-weighted-physical-conditions-v2';
export const CONDITIONS_SUITABILITY_MODEL_VERSION = 'conditions-fit-heuristic-v3';
export const SAFETY_POLICY_VERSION = 'safety-policy-v2';
export const START_RECOMMENDATION_POLICY_VERSION = 'recommendation-policy-v4-quarter-hour';
export const RUN_CONDITIONS_PRESENTATION_MODEL_VERSION = 'structured-reasons-v2';
export const PLANNING_PIPELINE_MODEL_VERSION = 'current-algorithm-system-slice-v2';
export const PLANNING_PIPELINE_MODEL_VERSION_V3 = 'canopy-weighted-radiation-v3';

/** Independent algorithm versions; update only the component whose semantics change. */
export const PLANNING_ALGORITHM_VERSION_MANIFEST: Readonly<PlanningAlgorithmVersionManifest> =
  Object.freeze({
    route: PLANNING_ROUTE_PARSER_MODEL_VERSION,
    timing: ROUTE_TIMING_MODEL_VERSION,
    weatherNormalizer: NORMALIZED_ROUTE_FORECAST_MODEL_VERSION,
    weatherSampler: ROUTE_FORECAST_SAMPLING_MODEL_VERSION,
    exposure: ROUTE_ENVIRONMENT_MODEL_VERSION,
    wind: RUNNER_RELATIVE_WIND_MODEL_VERSION,
    physicalConditions: PHYSICAL_EXPOSURE_MODEL_VERSION,
    preference: CONDITIONS_SUITABILITY_MODEL_VERSION,
    safety: SAFETY_POLICY_VERSION,
    recommendation: START_RECOMMENDATION_POLICY_VERSION,
    explanation: RUN_CONDITIONS_PRESENTATION_MODEL_VERSION,
    build: PLANNING_PIPELINE_MODEL_VERSION,
  });

export const PLANNING_ALGORITHM_VERSION_MANIFEST_V3: Readonly<PlanningAlgorithmVersionManifestV3> =
  Object.freeze({
    ...PLANNING_ALGORITHM_VERSION_MANIFEST,
    exposure: 'radiation-canopy-evidence-v3',
    canopy: CANOPY_MODEL_VERSION,
    physicalConditions: 'time-weighted-open-and-canopy-radiation-v3',
    preference: 'conditions-fit-canopy-radiation-v3',
    recommendation: 'recommendation-policy-v4-quarter-hour-canopy',
    explanation: 'estimated-canopy-filtering-v3',
    build: PLANNING_PIPELINE_MODEL_VERSION_V3,
  });
