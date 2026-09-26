# Algorithm 5: Runner-relative wind improvement plan

Status: proposed plan; no production implementation is authorized by this document.

Owners: core engine, forecast ingestion, route intelligence, mobile/web presentation, data science.

Depends on: route timing; Algorithm 3's normalized/provenance-rich weather field; Algorithm 4's shared terrain/building/canopy evidence; route topology/reversal; Algorithm 6 comfort/performance separation; alert policy.

Current delivery boundary: only the Algorithm 5 row in the
[program implementation commitment](README.md#current-implementation-commitment)
is active. The remaining phases and targets in this document are evidence-gated
design/research options, not current implementation scope.

## Executive verdict

The current vector projection is mathematically correct for answering one narrow question: “what component of the forecast 10 m ambient wind is aligned with this route bearing?” It is not a complete model of the airflow a moving runner experiences, the aerodynamic effort caused by that airflow, or the wind at pedestrian height on this route.

That distinction matters. The current comments and type name imply runner-relative wind, but the implementation omits runner velocity. A runner moving at 4 m/s through still air experiences 4 m/s of apparent airflow. A 4 m/s following ambient wind can nearly eliminate that airflow. A side wind changes both apparent-wind angle and aerodynamic drag. Runcast currently represents all three situations as if only the stationary forecast vector mattered.

The most important recommendation is not simply “add running speed to headwind.” Runcast needs three separate concepts:

1. forecast ambient wind, corrected cautiously for route exposure and runner height;
2. apparent airflow relative to the moving runner;
3. incremental aerodynamic cost relative to running at the same speed in still air.

Conflating those concepts would make a calm day look like a headwind in the UI. Keeping them separate gives the comfort/performance model the physically relevant quantity while preserving an understandable weather story.

This subsystem should remain a transparent, deterministic physics layer. A building-resolving CFD product is not a credible near-term scope. Terrain and urban shielding should enter first as bounded, explicitly uncertain corrections and should be retained only if field measurements show that they improve on raw 10 m wind.

## Current implementation and contracts

### Per-sample calculation

packages/core/src/engine/wind.ts computes:

\[
\delta = \operatorname{angleDelta}(D, B)
\]

\[
h = w\cos(\delta), \qquad c = \lvert w\sin(\delta)\rvert
\]

where:

- \(w\) is forecast wind speed at 10 m;
- \(D\) is meteorological direction from which the wind blows;
- \(B\) is route travel bearing;
- \(h>0\) means ambient wind from ahead, and \(h<0\) means ambient wind from behind;
- \(c\) is the unsigned across-route component.

It then assigns a class:

- calm when \(w < 1.5\) m/s;
- head for angular separation up to 45°;
- tail for separation of at least 135°;
- cross otherwise.

The tests establish exact compass cases, the 45° boundary, rotational invariance, reversal, and six hand-built wind-story outcomes. Those are useful unit tests for the present calculation, but they mostly prove the implementation is self-consistent rather than physically or empirically valid.

### Run summary and story

packages/core/src/engine/plan.ts counts distance as “headwind distance” whenever the preceding sample has \(h > 2\) m/s.

windStory:

- splits every route at half its total distance;
- treats the first half as “out” and the second half as “back”;
- uses distance-weighted mean along-route components in each half;
- uses 1 m/s, half the exported headwind-distance threshold, to label mostly-head and outbound/return stories;
- uses 2 m/s mean unsigned crosswind for the cross story;
- calls the residual moving-wind case shifty.

Mobile and web show headwind distance and the windStory phrase. Focused-sample UI shows forecast wind speed plus the angular class. The condition strip plots signed along-route wind and an unsigned crosswind band.

### Forecast inputs

packages/core/src/engine/weather.ts interpolates wind as a two-dimensional vector through time and between route anchors. This correctly avoids the 359°/0° direction discontinuity. It also means opposite winds at adjacent hours or anchors can cancel to calm at the midpoint; that is a modeling choice, not an observed transition.

The forecast schema already contains gusts. They are interpolated as scalars and currently affect only the run-window high-wind alert. Open-Meteo documents ordinary wind as an instantaneous 10 m value and hourly gust as the maximum of the preceding hour, so treating gust as another instantaneous sample would be semantically wrong ([Open-Meteo forecast documentation](https://open-meteo.com/en/docs)).

## Critical findings

| Severity | Finding                                                                                                                   | Why it matters                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | RelativeWind is ambient-route-relative, not runner-relative.                                                              | Comfort, effort, cold exposure, and user copy can be built on the wrong physical quantity.                                                                          |
| High     | The current linear comfort penalty has no validated mapping to nonlinear aerodynamic performance load.                    | Headwind and tailwind performance effects are asymmetric and a crosswind can add forward drag, but subjective comfort must remain a separate model.                 |
| High     | The model uses standard 10 m wind unchanged at roughly 1–2 m runner height.                                               | Standard wind exposure is deliberately open and unobstructed; a trail, street canyon, forest edge, bridge, or ridge can differ materially.                          |
| High     | Gust data are ignored in the per-segment experience and are linearly interpolated despite being a preceding-hour maximum. | A brief hazardous or highly unpleasant exposure is hidden by a mean-wind story.                                                                                     |
| High     | windStory invents “out” and “back” for loops and point-to-point routes.                                                   | The summary can make a geometrically false claim even when its arithmetic is correct.                                                                               |
| High     | Crosswind sign is discarded.                                                                                              | Runcast cannot say left/right, preserve full vectors, or correctly combine a later apparent-wind calculation.                                                       |
| High     | Fixed angular classes conflict with component thresholds.                                                                 | A 1.6 m/s wind from dead ahead is “head,” but contributes no headwind distance; a 5 m/s wind at 46° abruptly becomes “cross” despite a 3.47 m/s opposing component. |
| High     | Forecast/model uncertainty is absent.                                                                                     | A single direction near a category boundary creates false precision; distant forecasts and rapidly changing fronts deserve wider uncertainty.                       |
| Medium   | Linear vector interpolation can synthesize calm between opposing forecast vectors.                                        | Sometimes this is a useful mean; sometimes it erases a frontal shift and understates gustiness. The product does not disclose which interpretation it uses.         |
| Medium   | The run summary mixes incompatible thresholds: 1, 1.5, and 2 m/s plus 45°/135°.                                           | UI labels and numeric distance can contradict each other. None of these cutoffs has a documented validation basis.                                                  |
| Medium   | windStory assumes distance-half is the turnaround and attributes a midpoint-crossing gap wholly to one side.              | Asymmetric out-and-backs and sparse samples can be mislabeled.                                                                                                      |
| Medium   | No validation or normalization exists for negative speed, non-finite values, direction range, or degenerate bearings.     | Bad upstream data can propagate NaN into scores, bands, and recommendations.                                                                                        |
| Medium   | Runner morphology, air density, clothing, drafting, and local speed are absent.                                           | They change drag, although most should be optional or population-default parameters rather than required onboarding.                                                |
| Medium   | The category is treated as ground truth in UI bands.                                                                      | Rapid class flicker can be an artifact of bearing noise, forecast interpolation, or an arbitrary boundary.                                                          |

The 1980 Davies wind-tunnel study supports the existence and nonlinearity of aerodynamic cost, but it had only three subjects and must not be treated as a universal calibrated equation. It estimated calm-air aerodynamic energy costs around 2% at 5 m/s marathon speed and larger costs at higher speeds ([PubMed record and abstract](https://pubmed.ncbi.nlm.nih.gov/7380693/)). A more recent locomotion study explicitly discusses translating wind-tunnel airflow to overground apparent wind and reports gait changes under strong airflow ([Journal of Applied Physiology, DOI 10.1152/japplphysiol.00253.2024](https://doi.org/10.1152/japplphysiol.00253.2024)). These support a physics-based direction of travel, not exact consumer-product coefficients.

## Product semantics to settle first

Before implementation, name each output by the question it answers.

### Ambient route-relative wind

“How is the weather-system wind oriented along this stretch?”

This is the current \(h\) and a newly signed cross-route component. It is appropriate for phrases such as “wind from ahead” and for comparing route direction. It should not be called the total airflow felt by the runner.

### Apparent airflow

“What air velocity does the moving runner experience?”

Let \(\mathbf v_g\) be the runner’s local ground-velocity vector and \(\mathbf v_a\) the local ambient air-velocity vector pointing toward the direction the air moves. Define the runner-through-air vector used by the drag equations:

\[
\mathbf v_{r/a} = \mathbf v_g - \mathbf v_a
\]

The actual air-velocity vector observed in the runner's frame is the opposite vector, \(\mathbf v_{a/r}=\mathbf v_a-\mathbf v_g=-\mathbf v_{r/a}\). These have the same magnitude but opposite directions; user-facing “wind from/to” and left/right language must use the declared vector rather than swapping them. The forward component of runner-through-air is:

\[
v_{r/a,forward} = v_g + h
\]

when \(h\) retains the current convention. The signed cross component must also be retained. Local \(v_g\) should be derived from adjacent skeleton distance/time, so grade-adjusted changes in speed are represented; the global requested pace is only a fallback.

### Incremental aerodynamic load

“How much more or less aerodynamic work is required than at the same ground speed in still air?”

For a first-order model:

\[
\mathbf F_d = -\tfrac{1}{2}\rho C_dA\lVert\mathbf v_{r/a}\rVert\mathbf v_{r/a}
\]

The forward resisting force is the projection opposing \(\mathbf v_g\). The useful product quantity is the difference from the still-air baseline:

\[
\Delta F_{forward} =
\tfrac{1}{2}\rho C_dA
\left(
\lVert\mathbf v_{r/a}\rVert v_{r/a,forward} - v_g^2
\right)
\]

and incremental aerodynamic power is approximately:

\[
\Delta P_{aero}=\Delta F_{forward}v_g
\]

This avoids calling ordinary still-air running a “headwind” while capturing the asymmetry between headwind and tailwind. Negative \(\Delta P\) is assistance relative to calm, not free propulsion and not automatically a comfort bonus.

The coefficient \(C_dA\) and air density \(\rho\) should initially use documented population defaults and sensitivity ranges. Do not ask every user for body measurements until validation shows that personalization materially changes recommendations. Pressure, temperature, and humidity can refine density later.

## Proposed target architecture

### Layer 1: normalized forecast vector

Consume Algorithm 3's normalized wind-vector value with east/north components, provenance, valid-time semantics, lead time, model identity where exposed, and uncertainty. Do not create a parallel weather-normalization stack. Reject non-finite or negative speeds at that shared ingestion boundary and preserve original mean and preceding-period gust values rather than pretending they are interchangeable instants.

Circular direction should never be averaged independently from speed. The current vector interpolation is a sound default for a deterministic mean, but a large turn or cancellation must raise a transition/uncertainty flag rather than silently asserting calm.

### Layer 2: pedestrian-height exposure estimate

Build a wind-specific bounded multiplier/direction adjustment on Algorithm 4's shared, provenance-rich terrain/building/canopy evidence rather than fetching separate context data:

- open water, bridge, field, ridge, and exposed shoreline;
- forest interior, dense trees, and hedge barriers;
- urban building density and street-canyon orientation;
- local slope, ridge/valley orientation, and upwind terrain fetch;
- “unknown” when supporting data are missing.

A neutral logarithmic wind profile can be evaluated:

\[
u(z_r)=u(10)
\frac{\ln((z_r-d)/z_0)}
{\ln((10-d)/z_0)}
\]

where \(z_0\) is roughness length and \(d\) displacement height. It must not be adopted blindly. Numerical weather prediction already parameterizes surface roughness, and another generic correction can double-count it. The production candidate should be a bounded, calibrated transformation selected by out-of-sample field error, with the raw 10 m forecast always retained for comparison.

The standard observation itself is intentionally representative of wind at 10 m over open, level terrain and away from obstructions ([Environment and Climate Change Canada MANOBS, based on WMO standards](https://www.canada.ca/en/environment-climate-change/services/weather-manuals-documentation/manobs-surface-observations.html)). That is evidence for the mismatch, not evidence that any particular downscaling formula will work on a given street.

Do not attempt route-scale CFD in the client. Building-resolving wind simulation is computationally expensive and very sensitive to geometry and boundary conditions. A later server-side research prototype may be justified only after cheaper directional exposure features reach a clear accuracy ceiling.

### Layer 3: apparent airflow and aerodynamic response

At each route-time sample:

1. derive local runner velocity from the timed route skeleton;
2. compute the corrected ambient vector and its uncertainty;
3. compute signed ambient along/cross components;
4. compute both the runner-through-air vector used for drag and the opposite apparent air-velocity vector used for directional presentation;
5. compute incremental forward drag/power and lateral load for mean and gust scenarios;
6. expose physically meaningful continuous values to the scoring layer.

Gust should be a scenario envelope, not added to every instant. With no gust direction forecast, preserving mean direction and replacing magnitude with gust speed is only conservative for an opposing or quartering headwind; a same-direction tail gust can reduce resistance or assist. Use an explicit directional envelope/unknown when direction is unsupported, carry low confidence during convective weather, and expose mean, likely-peak, and probability/coverage semantics separately.

### Layer 4: route story and presentation

Continuous values are the source of truth. Categories are presentation summaries.

- Determine route topology before using outbound/return language. Only a route with a validated turnaround/out-and-back structure may receive those stories.
- For a loop, use sector- or fraction-based language: “more resistance on the north side,” “mixed wind around the loop,” or simply “variable.”
- For point-to-point routes, use “wind mostly from ahead/behind/side.”
- Preserve left/right internally, but show it only where useful and where bearing confidence is adequate.
- Base head/cross/tail dominance on component magnitudes and uncertainty, not angle alone.
- Add hysteresis or minimum-band length so bearing noise does not create dozens of tiny categorical bands.
- Show gust separately: for example, “mean resistance moderate; exposed gusts strong.”
- Replace “Headwind 4.8 mi” with an explicit metric such as “2.1 mi with ambient opposition above 2 m/s,” or preferably a distance/time plus peak/median resistance summary tested with users.

Thresholds must be centralized in a versioned policy object and justified by UX discrimination or field outcomes. The current 1, 1.5, and 2 m/s collection should not survive as unrelated constants.

### Layer 5: uncertainty and confidence

Where ensemble data are available, calculate member-wise vectors and derived loads before summarizing. Do not derive uncertainty by applying a nonlinear drag equation only to ensemble-mean wind. Open-Meteo now exposes ensemble mean and spread products, although availability and retention vary ([Ensemble Mean API](https://open-meteo.com/en/docs/ensemble-mean-api)).

At minimum, return:

- median ambient and apparent wind;
- a central interval for speed, direction, and incremental load;
- probability of material ambient opposition;
- confidence reasons: forecast lead time, model resolution, ensemble disagreement, route exposure unknown, direction transition, or gust-direction assumption.

Recommendation logic should prefer robust improvements. A one-point benefit that reverses under plausible direction error should not change the recommended start or route direction.

## Alternatives and tradeoffs

### Keep the current component projection and only rename it

This is the lowest-risk semantic fix and should be done even if later stages stop. It prevents misuse, but it does not improve effort, cold exposure, or local wind accuracy.

### Add runner speed only

This fixes apparent airflow but is inadequate as a user-visible “headwind” metric and still uses raw 10 m wind. It is suitable as a short-lived internal step, not the completed feature.

### Empirical effort spline instead of drag physics

A learned function of ambient components, pace, and runner feedback could rank perceived wind annoyance. It may fit users better but extrapolates poorly and can violate physics. A better approach is a physics baseline plus a calibrated residual.

### Full thermophysiological coupling

Apparent wind should affect both aerodynamic effort and convective cooling. That coupling belongs in the comfort/thermal model described in [Algorithm 6](06-comfort-scoring.md). Wind must not independently decide whether cooling is good or bad.

### Street-level CFD

Potentially highest spatial fidelity, but currently unjustified in cost, data quality, latency, global coverage, and validation burden. Keep it as research, not a roadmap commitment.

## Staged implementation plan

### Stage 0 — Semantic hardening and benchmark

- Rename the conceptual outputs in design documents and proposed types: ambientAlong, ambientCrossSigned, apparentAir, and aeroDelta.
- Inventory every consumer of RelativeWind, headwindDistance, WindClass, and windStory.
- Build a frozen benchmark corpus from current plans, including loops, true out-and-backs, point-to-point routes, sharp switchbacks, calm conditions, fronts, and route reversals.
- Add model provenance and forecast valid-time semantics to diagnostic output.
- Establish current field error against runner-height measurements before choosing a correction.
- Document current UI thresholds and contradictions.

Exit: the team can reproduce old results by engine version and has baseline accuracy, latency, band count, and story-label metrics.

### Stage 1 — Vector and topology correctness

- Preserve signed cross-route components.
- Add local runner velocity and apparent-airflow calculation without changing public recommendation ranking.
- Add validation for speed, direction, non-finite inputs, degenerate samples, and zero-duration segments.
- Replace half-distance out/back inference with an explicit route-topology result and turnaround distance.
- Centralize category thresholds and add hysteresis/minimum segment length.
- Keep legacy outputs in parallel for compatibility and comparison.

Exit: mathematical/property tests pass; non-out-and-back routes never get outbound/return copy; shadow output is stable in production telemetry.

### Stage 2 — Aerodynamic load

- Implement the population-default drag model and still-air baseline as a versioned internal model.
- Derive local speed from route timing and propagate uncertainty.
- Run sensitivity analysis for body area, drag coefficient, density, pace, crosswind, and tailwind exceeding runner speed.
- Feed incremental aerodynamic load, not raw ambient headwind, into the experimental comfort/performance model.
- Do not yet personalize body parameters unless sensitivity and field feedback show decision-level benefit.

Exit: equations match reference calculations, results remain bounded and continuous, and wind-caused candidate ordering passes expert scenario review.

### Stage 3 — Gust and forecast uncertainty

- Preserve gust period/max semantics.
- Add mean and likely-peak scenario outputs with a documented same-direction assumption.
- Evaluate higher temporal-resolution model data where available.
- Calculate member-wise outputs from ensembles and report intervals/probabilities.
- Add robust recommendation tie handling so uncertain marginal differences do not become “best.”

Exit: uncertainty intervals are calibrated on archived forecast/observation pairs and strong gust cases are visible without treating peak gust as continuous exposure.

### Stage 4 — Exposure downscaling

- Create directional exposure features from land cover, canopy, buildings, bridge/open-water tags, DEM slope, and upwind fetch.
- Compare bounded log-profile, rules-based, and learned residual models using blocked validation by city/region.
- Keep “unknown” as a first-class result; never substitute sheltered merely because context data are absent.
- Roll out correction by environment class only when it beats raw 10 m wind out of sample.

Exit: the correction meets field gates below in multiple climate and urbanicity strata; otherwise retain raw wind plus low-confidence messaging.

### Stage 5 — UI and recommendation rollout

- User-test continuous summaries, category copy, gust presentation, and uncertainty.
- Shadow-rank start times and route reversals with legacy and new models.
- Release behind independent server-controlled flags for calculation, ranking, and copy.
- Bump ENGINE_VERSION and persist model/config versions with snapshots.
- Remove legacy fields only after all supported clients and stored snapshots migrate.

## Verification plan

### Deterministic and property tests

- Rotation invariance for ambient and apparent vectors.
- Vector reconstruction: along² + cross² equals corrected ambient speed² within tolerance.
- Still air: apparent speed equals local runner speed and incremental aerodynamic load is zero.
- Direct headwind: apparent speed equals runner speed plus wind speed.
- Following wind equal to runner speed: apparent speed approaches zero.
- Faster following wind: apparent direction reverses without NaN or discontinuity.
- Pure crosswind: apparent magnitude follows the Pythagorean result and adds forward drag relative to still air.
- Reversal: signed ambient along component changes sign; the earth-frame air vector does not.
- Negative, infinite, NaN, missing, out-of-range, and duplicate-time inputs produce explicit validation outcomes.
- Resampling a segment does not materially change its integrated wind burden.
- Splitting a midpoint-crossing gap gives the same out/back result as an exactly sampled midpoint.
- Loops and point-to-point routes never emit out/back stories.
- Category hysteresis bounds band fragmentation under small bearing perturbations.
- Gust maxima are never linearly presented as ordinary instantaneous wind.
- Opposing-vector interpolation raises a transition/low-confidence signal.

### Golden scenarios

Maintain human-readable cases for:

- calm open road at several paces;
- headwind, following wind below/equal/above pace, and crosswind;
- sheltered urban street opening onto a bridge;
- forest interior and exposed ridge;
- symmetric and asymmetric out-and-backs;
- loop with four cardinal legs;
- frontal passage with a 180° direction change;
- convective high-gust hour;
- short sprint versus slow long run;
- missing exposure and ensemble data.

Each golden case should include raw inputs, expected qualitative story, relevant equations, allowable numeric tolerance, safety flags, and confidence reason.

### Field validation

Use a prospective, pre-registered measurement protocol rather than anecdotal app feedback:

- synchronized runner-height ultrasonic or cup-anemometer measurements, plus a reference 10 m/open exposure where practical;
- diverse open, suburban, dense-urban, forest, ridge, waterfront, and bridge segments;
- multiple ambient directions and stability/weather regimes;
- repeated passes in both travel directions;
- device placement and runner-body disturbance documented;
- model selection blocked by route, day, city, and runner to prevent leakage;
- separate accuracy for ambient vector, apparent airflow, and perceived/effort outcomes.

The recent field literature confirms substantial pedestrian-level urban turbulence and emphasizes measurements below 2 m, but it does not provide a universal correction factor ([Building and Environment field study](https://www.sciencedirect.com/science/article/pii/S0360132321001244)).

### Performance tests

- Benchmark 50, 500, and maximum-supported sample routes on representative low-end mobile hardware.
- Measure p50/p95 compute-plan latency, allocation, cache size, and ensemble multiplication.
- Keep a deterministic non-ensemble fast path for interactive scrubbing.
- Run more expensive uncertainty aggregation off the gesture-critical path if needed.

## Measurable acceptance criteria

These are release gates, not claims that the current model meets them.

1. Mathematical invariants above pass for at least 100,000 generated finite cases with no non-finite outputs and relative error below 1e-9 where conditioning permits.
2. No annotated loop or point-to-point case emits out/back wording; true out-and-back story agreement is at least 90% on a held-out, independently labeled corpus, with disagreements reviewed by route class.
3. The new runner-height mean-wind estimate reduces vector RMSE by at least 20% relative to raw 10 m wind on held-out field routes, and no reported environment stratum worsens by more than 5%. If this gate fails, do not ship downscaling for that stratum.
4. The nominal 80% forecast/load interval contains the measured value 70–90% of the time overall and calibration by lead-time bucket is published internally. Tighten the band only with evidence.
5. New wind ranking improves held-out pairwise “which run felt more wind-burdened?” accuracy by at least 10 percentage points over legacy, with a 95% confidence interval excluding zero.
6. Strong-gust golden cases always expose the gust scenario and preserve the existing high-wind alert or a stricter successor.
7. Interactive deterministic calculation remains within a 2 ms p95 incremental wind budget for 500 samples on the agreed reference mobile device; ensemble computation must not block slider frames.
8. Category-band count at p95 does not increase after hysteresis, and synthetic ±2° bearing noise changes no more than 2% of categorized route distance outside a genuine boundary case.
9. A new model changes the selected recommendation only when its robust benefit exceeds a product-approved meaningful-difference threshold; ties are explicit and deterministic.

Absolute field thresholds should be revisited after Stage 0 establishes sensor error and forecast baselines. Do not weaken a failed gate by redefining the evaluation set after results are known.

## Telemetry, privacy, and observability

Log only what is needed to evaluate the model:

- engine, forecast, exposure-data, and coefficient versions;
- coarse environment class and forecast lead-time bucket;
- old/new aggregate wind outputs, confidence reason, and whether ranking changed;
- calculation latency and validation fallbacks;
- optional post-run wind-burden rating and whether the recommendation influenced timing/direction.

Do not send raw route geometry or per-sample location merely to tune wind. Prefer on-device aggregation, coarse spatial cells with minimum cohort sizes, short retention, explicit opt-in for research-grade traces, export/deletion support, and separation from account identity. A route and habitual time can reveal home, work, religion, health routines, and personal safety patterns.

Monitor fallback rate, missing-context rate, ensemble coverage, interval width, story distribution, recommendation churn, and model disagreement by broad region/environment. Do not optimize only for engagement or recommendation acceptance; either metric can reward overconfident advice.

## Safety and ethical constraints

- Wind comfort and aerodynamic effort are not wind safety. Keep official alerts, gust/debris risk, lightning, waves, wildfire, falling trees, and access restrictions separate.
- Never describe a sheltered forest route as safer during high winds merely because predicted mean wind is lower; falling limbs can make it more dangerous.
- Do not encourage pace changes to “beat” a hazardous weather window.
- Show uncertainty when local shielding data or gust direction are unknown.
- Avoid body-size personalization that stigmatizes users or demands unnecessary sensitive measurements. Defaults plus an optional calibrated preference are preferable.
- Do not infer protected health characteristics from pace, body measurements, or wind feedback.
- Preserve user agency: explain the tradeoff and offer alternatives rather than labeling one route universally optimal.

## Rollout and migration

- Add a new wind schema alongside RelativeWind; do not silently change the meaning of existing fields.
- Persist wind-model version, coefficient-set version, and forecast semantics with plans/snapshots.
- Dual-compute legacy and new values during shadow rollout.
- Version derived summaries and invalidate only caches whose semantics actually changed.
- Update mobile, web, API serialization, fixtures, snapshots, analytics schemas, and explanatory copy before removing legacy fields.
- Bump ENGINE_VERSION when candidate ranking can change.
- Support rollback by configuration to legacy ranking while leaving new diagnostics intact.
- Publish a concise model note in the app before presenting new precise-looking metrics.

## Open decisions

1. Is the primary wind product about weather orientation, perceived burden, aerodynamic performance, or all three shown separately?
2. Should user-facing crosswind include left/right, or is the sign internal only?
3. Which route-topology confidence is required before out/back wording appears?
4. What constitutes a meaningful wind difference for recommendation changes?
5. Is population-default \(C_dA\) sufficient, or should optional height/build/clothing profiles be evaluated?
6. Which forecast sources expose ensembles and high-frequency gust semantics consistently enough for production?
7. Which exposure inputs have acceptable licensing, coverage, update cadence, and cache cost?
8. How should gust effects be summarized when only magnitude, not gust direction, is forecast?
9. Should wind-adjusted performance be a separate feature from comfort?
10. What reference mobile hardware and latency budget define the release gate?

## Evidence boundary and sources

The following sources motivate the redesign. They do not validate Runcast’s proposed coefficients or thresholds.

- Open-Meteo defines ordinary wind at the standard 10 m level and hourly gusts as the preceding-hour maximum: [Weather Forecast API documentation](https://open-meteo.com/en/docs).
- WMO-aligned surface-observation guidance specifies 10 m, open/level exposure away from obstructions: [Environment and Climate Change Canada MANOBS](https://www.canada.ca/en/environment-climate-change/services/weather-manuals-documentation/manobs-surface-observations.html).
- Davies measured nonlinear energetic effects of assistance/resistance in a small wind-tunnel study and estimated a nonzero calm-air running cost: [Effects of wind assistance and resistance on the forward motion of a runner](https://pubmed.ncbi.nlm.nih.gov/7380693/).
- A recent experimental review/study describes runner-frame apparent wind and locomotor changes: [Biomechanics of human locomotion in the wind](https://doi.org/10.1152/japplphysiol.00253.2024).
- Pedestrian-level urban field measurements show that sub-2 m turbulence and exposure need direct validation: [Field measurement of the urban pedestrian level wind turbulence](https://www.sciencedirect.com/science/article/pii/S0360132321001244).
- Open-Meteo documents direct mean/spread ensemble products and their availability limits: [Ensemble Mean API](https://open-meteo.com/en/docs/ensemble-mean-api).
- The NATA cold-injury statement explicitly notes that running-generated airflow is not included in ordinary wind-chill input and should be considered: [Environmental Cold Injuries](https://pmc.ncbi.nlm.nih.gov/articles/PMC2582557/).

## Definition of done

This improvement is done only when terminology, vector physics, topology-aware stories, gust semantics, uncertainty, local-exposure validation, UI, versioning, and field evidence ship together. Replacing \(w\cos\delta\) with \(v_g+w\cos\delta\) while leaving names, score coupling, and UI unchanged would exchange one ambiguity for another and is not completion.
