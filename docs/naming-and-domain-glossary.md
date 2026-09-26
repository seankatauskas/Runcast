# Naming and domain glossary

This document is the authoritative vocabulary for planning-domain code. Names in API schemas,
database columns, stored snapshots, and compatibility adapters may differ because those boundaries
must remain stable.

## Naming rules

- Use unversioned names for the current planning domain and engine.
- Use `Legacy` only for stored-data DTOs and read/migration adapters that predate the current engine.
- Use version suffixes at API, serialized-schema, persistence, and independently versioned evaluator boundaries.
- Use `…MODEL_VERSION` for an independently versioned calculation or presentation model.
- Use `…POLICY_VERSION` for independently versioned eligibility or decision policy.
- Migrate internal consumers and remove retired runtime aliases. Historical wire DTO names remain in contracts; obsolete public evaluator aliases are not supported.
- Name a value for its domain meaning, not the implementation generation that produced it.

## Canonical planning pipeline

```text
normalized forecast
→ route environment
→ safety assessment + physical exposure + conditions suitability
→ start recommendation
→ runner-facing presentation
```

The stages are deliberately separate. Provider normalization does not make a safety decision;
physical exposure does not encode runner preferences; presentation does not change the selected
start.

## Core domain terms

### `PlanningRoute`

The current engine's route geometry, cumulative distance, elevation data, and route-quality
evidence. A route can be usable while explicitly recording degraded or absent elevation.
`PlannableRouteV2` remains the corresponding V2 serialized-contract name.

### `NormalizedRouteForecast`

A provider-independent, route-aligned weather forecast with explicit units, validity, provenance,
missing-value counts, and content identity. It describes forecast inputs; it is not an evaluated
run. `NormalizedWeatherFieldV2` remains the V2 serialized-contract name.

### `WoodlandEvidenceProfile`

Distance-indexed evidence about mapped woodland. Values distinguish mapped woodland, evidence of
no mapped woodland, and unknown or incomplete evidence. Woodland evidence is not a claim that the
runner will be shaded.

### `RouteEnvironmentProfile`

Environmental evidence aligned to a `PlanningRoute`, including the `WoodlandEvidenceProfile`.
Future environmental sources belong here when they are observations or evidence rather than
runner-facing conclusions.

### `SafetyAssessment`

Hard eligibility and caution results. Safety reasons can block a candidate and cannot be offset by
a high conditions-suitability score. Safety policy versions use `…POLICY_VERSION` names.

### `PhysicalExposureSummary`

The modeled physical conditions accumulated over one run: thermal conditions, precipitation,
wind effects, sunlight exposure, and related quantities. This stage reports physics and does not
apply preference weights.

### `ConditionsSuitabilityAssessment`

The runner-specific suitability result derived from physical conditions and preferences. It may
rank eligible candidates but cannot override a safety block.

### `EvaluatedRun`

One candidate start time evaluated across route timing, safety, physical exposure, and conditions
suitability. Serialized V2 plans retain their existing JSON keys and reason codes.

### `StartRecommendation`

The decision across evaluated candidate starts, including status, winner, reasons, version
manifest, and identity. `RecommendationV2` remains the V2 serialized-contract name.

### `PlanningAlgorithmVersionManifest`

The independently versioned route, timing, normalization, exposure, suitability, safety,
recommendation, explanation, and build components used for an evaluation. Existing algorithm
version strings are stable data and must not change during a naming refactor.

## Sun and shade terms

### `forecastSunlight`

Point-in-time forecast sunlight intensity, measured as irradiance in watts per square metre
(`W/m²`). Presentation labels such as low, moderate, strong, or intense sunlight are derived from
this quantity.

### Radiation dose

Sunlight energy accumulated across time, measured in joules per square metre (`J/m²`). Radiation
dose belongs to `PhysicalExposureSummary`. It must not be labeled or treated as point-in-time
sunlight intensity.

### `woodlandEvidence`

Mapped environmental evidence at a route location. It can support a shade possibility but does
not establish tree density, canopy state, sun angle, or actual shade.

### `possibleShade`

A conservative runner-facing presentation inferred from mapped woodland evidence. Background gaps
in the sunlight display mean possible shade, not guaranteed shade. Unknown evidence remains
visually conservative.

### Sun exposure display

`SunExposureSegmentDisplay` and `SunExposureDisplayBand` are presentation-model terms. Their
independent model identity is `SUN_EXPOSURE_DISPLAY_MODEL_VERSION`; it is not a wire-schema
version.

## Code ownership by layer

- `packages/core/src/engine/planning/` owns the current portable planning engine.
- Shared pure planning transforms and presentation helpers live in core; apps own rendering and lifecycle.
- Explicit persistence adapters isolate stored legacy route data and historical V2/V3 snapshots.
- Woodland evidence acquisition fetches and parses evidence; it does not decide actual shade.
- API route-forecast repositories own persistence access and preparation leases.
- Prepared route forecasts are provider-normalized inputs ready for bundle assembly; a planning
  bundle is the separate serialized delivery artifact.

## Stable boundaries

Current-only retirement intentionally replaces reader-2 delivery and the old route-bundle endpoint with update-required responses. It must not rename or reinterpret:

- historical response DTOs and stored notification references;
- JSON keys, enum values, schema versions, reason codes, or algorithm version strings;
- SQL migrations, database columns, SQLite fields, or stored snapshots;
- bundle hashes, ETags, content/input hashes, or evaluation identities.

When boundary code uses a V2 name, translate it once into the unversioned domain vocabulary. When
returning to a boundary, map back without changing byte representation.
