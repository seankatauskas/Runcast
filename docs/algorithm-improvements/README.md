# Runcast algorithm improvement program

## Purpose

This directory is a critical design review of the seven algorithms that turn a GPX route and a weather forecast into a recommended run time. Each document describes the implementation that exists today, the assumptions it makes, how it can fail, a materially stronger target, and a staged path to validate and ship that target.

These are engineering plans, not claims that every proposed feature should be built. The plans deliberately distinguish:

- correctness defects from model limitations;
- safety policy from comfort preference;
- improvements supported by existing inputs from improvements requiring new data;
- attractive model complexity from changes that can be proven useful;
- deterministic uncertainty from forecast, sensor, and user uncertainty;
- MVP-compatible steps from research programs.

## The eight plans

1. [Route geometry and timing](01-route-geometry-and-timing.md)
2. [Grade-adjusted pace](02-grade-adjusted-pace.md)
3. [Space-time weather interpolation](03-space-time-weather-interpolation.md)
4. [Solar exposure and canopy](04-solar-exposure-and-canopy.md)
5. [Runner-relative wind](05-runner-relative-wind.md)
6. [Comfort scoring](06-comfort-scoring.md)
7. [Best-start recommendation](07-best-start-recommendation.md)
8. [Client/server planning architecture](08-client-server-system-design.md)

The first seven documents own the algorithm stages. Plan 8 owns their shared
runtime, artifact, latency, privacy, reliability, and migration boundaries.
Plan 8 is an architectural envelope, not a commitment to build every described
component. Its portfolio/MVP delivery profile—one modular API, one worker,
PostgreSQL, one versioned bundle response, shared local evaluation, and
immutable notifications—is the default implementation scope. Advanced storage,
queues, GIS, ensembles, personalization, and service splits require measured
activation evidence.

## Current implementation commitment

The table below is the governing implementation scope for Algorithms 1–7. Only
the **Implement now** column is committed. The fuller targets, later phases,
experiments, and release gates in the individual plans remain design and
research references; they are not an active backlog and are not automatically
promoted when the current vertical slice is complete. Expanding this boundary
requires an explicit scope decision and, where architecture or product
semantics change, an ADR with measured justification.

| Algorithm                    | Implement now                                                                                                                                                 | Deferred reference options                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Route geometry and timing | Preserve GPX segment boundaries, represent missing elevation honestly, validate bounded imports, and emit route-quality metadata.                             | Advanced DEM correction, global geometry enrichment, and higher-order spatial models.          |
| 2. Grade-adjusted pace       | Version the pace model, define flat-pace/effort semantics, and use a quality-aware flat fallback when grade inputs are unreliable.                            | Field-trained population curves, fatigue models, and learned personalization.                  |
| 3. Weather interpolation     | Correct variable-specific temporal semantics, enforce validity ranges, preserve missingness, and normalize authenticated forecasts on the server.             | Full ensembles, learned downscaling, and terrain-specific forecast systems.                    |
| 4. Solar exposure and canopy | Correct sunrise/refraction semantics, handle multipolygons and relation holes, preserve unknown coverage, and use radiation variables consistently.           | Lidar, full 3D building/terrain models, and advanced ray tracing.                              |
| 5. Runner-relative wind      | Correct runner-relative vector and apparent-airflow calculations while keeping ambient wind, airflow, and aerodynamic effect distinct.                        | Street-level downscaling, computational fluid dynamics, and learned shielding.                 |
| 6. Comfort scoring           | Separate safety, physical load, and preference; integrate exposure over time; and prevent preference from compensating for hazards.                           | Detailed physiological simulation and learned personal comfort models.                         |
| 7. Best-start recommendation | Filter unsafe, unevaluable, elapsed, and unactionable starts; return unavailable/no-suitable states; persist immutable snapshots; and rank deterministically. | Full probabilistic optimization, extensive personalization, and ensemble-driven robust search. |

## Reviewed implementation baseline

The program was reconciled with commit `b8600e3` (`Implement Strava-first
authentication`, 2026-07-18). That commit does not change Algorithms 2–7. It
does establish a provider-neutral Runcast owner ID, makes Strava a primary
sign-in and explicit route-import path, preserves guest planning, and resets
the prior authenticated beta data. The resulting route-ingestion and
client/server implications are recorded in Plans 1 and 8.

## System dependency chain

```text
GPX and elevation quality
        ↓
route geometry, grade, and arrival-time distribution
        ↓
weather + solar + coverage/canopy + wind at each arrival point
        ↓
condition features, safety rules, and preference utility
        ↓
candidate feasibility, robust ranking, confidence, and explanation
        ↓
interactive planner and scheduled watch notification
```

An error near the top shifts every downstream result. A ranking algorithm cannot correct an incorrect arrival time, and a refined comfort score cannot recover a hazard absent from provider inputs or mishandled by hazard-domain/validity semantics. Work should therefore be evaluated end-to-end even when implementation is divided by module.

## Program-level findings

### Preserve the deterministic shared engine

The pure `@runcast/core` pipeline is one of the project's strongest architectural decisions. Mobile, web, tests, and the API use the same logic. Improvements should retain reproducibility, framework independence, explicit units, versioned semantics, and bounded computation.

### Stop treating point estimates as ground truth

The current output is much more precise than its inputs justify. GPS tracks, GPX elevation, runner pace, forecast fields, canopy data, and user comfort all contain uncertainty. Each stage should produce quality and provenance metadata. The UI should distinguish `unknown` from neutral or safe, and the recommender should be able to abstain.

### Separate four concepts now collapsed together

1. **Physical conditions:** estimated temperature, radiation, precipitation, and relative airflow.
2. **Exposure:** how much and how long the runner encounters those conditions.
3. **Safety policy:** conditions that block or caution outdoor activity.
4. **Preference utility:** what a particular runner is likely to find comfortable.

A weighted comfort score must never be allowed to compensate for a hard safety rule.

### Validate before personalizing

Personalization is valuable only after the physical model and recommendation policy have reproducible baselines. Otherwise, learned preferences can absorb systematic weather or timing errors, producing a model that appears engaging but does not generalize and cannot be audited.

### Prefer measured gains over model sophistication

Every plan defines a simple baseline and a stronger alternative. New interpolation, optimization, or learned models should ship only when they reduce error or decision regret on a frozen corpus, stay inside mobile/server budgets, and preserve understandable failure behavior.

## Shared quality contract

The pipeline should converge on a common metadata envelope. Exact types belong in an architecture decision record, but every derived value should be traceable to:

- source/provider and immutable input identity;
- issue/fetch time and validity interval;
- model and policy versions;
- spatial and temporal resolution;
- known missing or substituted inputs;
- uncertainty or confidence where calibrated;
- fallback path used;
- warnings that affect downstream eligibility.

`unknown` must not be silently converted to `open`, `calm`, `dry`, `safe`, or average comfort. A conservative fallback may be appropriate, but it must remain observable.

## Shared validation layers

### 1. Mathematical tests

Use unit, property, metamorphic, and adversarial tests for invariants: monotonic cumulative distance and time, circular directions, bounds, conservation under interpolation, reversal symmetry where applicable, and typed behavior for invalid inputs.

### 2. Golden fixtures

Keep immutable routes and forecast snapshots covering flat, hilly, loop, out-and-back, urban canyon, forest, coastal, mountain, sunrise/sunset, precipitation boundary, extreme heat, high wind, and DST cases. Store expected intermediate features, not only final scores, so regressions can be localized.

### 3. Hindcast and reference data

Evaluate forecasts as they were issued against independent observations or analysis. Stratify by geography, terrain, season, lead time, model, route duration, and hazard. Do not tune and report performance on the same locations and dates.

### 4. Field studies

With explicit consent, compare predicted arrival timing and perceived conditions with activity data and short structured feedback. Keep preference labels separate from safety outcomes. Never interpret a user's willingness to run in hazardous conditions as proof that the conditions were safe.

### 5. Decision metrics

In addition to per-feature physical error, measure the outcome of the whole system:

- recommendation regret against a finer validated oracle;
- rate of ineligible or unevaluable selections;
- confidence calibration and abstention coverage;
- run-to-run recommendation churn;
- explanation fidelity;
- computation, network, and storage cost;
- fallback and stale-data rates.

## Recommended sequencing

This sequence records dependency order for the complete design archive. The
current implementation stops at the items in the commitment table above;
finishing one stage does not authorize the unselected work in that stage or a
later stage.

### Stage A — contracts, hazards, and false precision

1. Add input validation, validity bounds, provenance, and quality flags.
2. Separate safety eligibility from comfort and recommendation utility.
3. Stop silently evaluating outside weather coverage.
4. Define honest UI states for unavailable, low-confidence, caution, and no suitable window.

This stage prevents the most consequential failure modes without requiring a new predictive model.

Stage A is the blocking contract/safety track and should ship first. Geometry/elevation correction, weather semantics, and benchmark construction can proceed in parallel behind versioned boundaries, but a richer physical model must not bypass Stage A quality, availability, and safety contracts. Algorithm-specific “first” recommendations refer to the first change within that track: scheduled eligibility is the first decision-layer fix, while segment/elevation handling is the first geometry-layer fix.

### Stage B — reference datasets and physical corrections

1. Build the shared golden-route and hindcast corpus.
2. Quantify geometry/elevation and grade-timing errors.
3. Improve weather treatment for discontinuous precipitation and terrain-sensitive fields.
4. Correct wind/exposure semantics and propagate uncertainty.

This stage establishes whether more sophisticated models improve the physical estimates users actually encounter.

### Stage C — robust decision quality

1. Replace scalar-only ranking with eligibility plus a score vector.
2. Validate candidate-grid precision and add refinement only if useful.
3. Introduce forecast ensembles, confidence, alternatives, and recommendation stability.
4. Rework comfort as a calibrated preference layer over separately computed physical and safety features.

### Stage D — personalization and advanced spatial models (deferred)

1. Add explicit preference controls.
2. Calibrate per-user timing and comfort only with consented data and shrinkage to safe population defaults.
3. Consider building/terrain shadow models, street-level roughness, and learned bias correction where coverage and measured benefit justify their operational cost.

## Change-control requirements

- Split the current engine version into physical-model, comfort-policy, recommendation-policy, and safety-policy versions where their lifecycles diverge.
- Persist enough input identity to reproduce every scheduled recommendation.
- Shadow-compute major revisions before exposing them.
- Release interactive forecasts before unattended push decisions.
- Maintain kill switches and fallback behavior per algorithm.
- Document schema migration and old-snapshot readability.
- Treat threshold or policy changes as behavior changes even when no API shape changes.

## Definition of done for this planning program

Planning is complete when each algorithm has:

- an accurate description of the code and equations in production;
- prioritized, concrete failure modes;
- alternatives with explicit tradeoffs;
- a recommended target that composes with the other six stages;
- validation and observability plans;
- incremental rollout and rollback paths;
- measurable release gates;
- named decisions that require product, safety, data, cost, or privacy input.

Implementation should begin only after cross-document contracts—especially quality metadata, safety semantics, and version boundaries—are captured in architecture decision records.
