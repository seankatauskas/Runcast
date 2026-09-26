# Algorithm 3: Space–time weather interpolation improvement plan

Status: proposed
Scope: `packages/core/src/engine/weather.ts`, `interpolate.ts`, `plan.ts`, `types.ts`; `packages/core/src/io/openMeteo.ts`; mobile/web fetch state; API scheduler forecast cache
Planning only: this document does not prescribe an immediate production-code change.

Current delivery boundary: only the Algorithm 3 row in the
[program implementation commitment](README.md#current-implementation-commitment)
is active. The remaining phases and targets in this document are evidence-gated
design/research options, not current implementation scope.

## Executive judgment

The current implementation is a clear, compact MVP, but it presents a smooth, high-resolution-looking weather field that the source data cannot support. Its best feature is correct interpolation of wind as a vector rather than as an angle. Its biggest problem is not ordinary forecast error; it is hidden semantic error introduced after the forecast is fetched:

- hourly precipitation totals, hourly gust maxima, instantaneous temperatures, probabilities, and categorical codes do not share the same temporal meaning, yet most are linearly interpolated identically;
- queries may resolve adjacent anchors to different grid cells or automatically selected models; the adapter discards returned cell coordinates/elevation/units, while the Best Match endpoint generally does not expose exact per-value model/run/native-resolution lineage;
- missing precipitation probability is converted to 0%, turning “not supplied” into “certainly dry”;
- requests outside the returned horizon silently clamp to the first or last value, turning stale data into an apparently valid forecast;
- two to eight distance-spaced anchors are chosen without regard to provider grid spacing, elevation, coastlines, terrain barriers, duplicate resolved cells, model seams, or the route crossing itself;
- forecast uncertainty and recommendation instability are not represented at all.

This is acceptable for a demo label such as “approximate route forecast.” It is not yet a defensible basis for a confident best-start recommendation, especially for convective rain, mountain routes, coasts, fronts, or forecasts near the horizon.

The recommended direction is a typed forecast-field pipeline with explicit temporal semantics, validated provider metadata, adaptive and deduplicated anchor planning, conservative handling of accumulated/extreme variables, and uncertainty-aware output. Do not begin with kriging or a machine-learning downscaler. First stop manufacturing certainty from missing, stale, and semantically mismatched values.

## What exists today

### Fetch and anchor model

`anchorDistances` in `openMeteo.ts`:

1. computes `round(routeDistance / 2,500 m) + 1`;
2. clamps the count to 2–8;
3. spreads anchors evenly by route distance, including start and finish;
4. samples route position at each distance;
5. rounds latitude/longitude to four decimal places;
6. sends every location in one Open-Meteo request;
7. requests three forecast days of hourly temperature, apparent temperature, humidity, 10 m wind, gust, cloud, precipitation probability/amount, and weather code.

The adapter reduces the response to arrays plus `fetchedAt`; only the first location’s timezone survives. It discards provider-returned latitude/longitude, elevation, unit declarations, per-location timezones, and `generationtime_ms` (response computation duration, not forecast issue time). The Best Match endpoint generally does not supply exact per-value model/run/native-resolution lineage, so the adapter cannot preserve metadata it never receives.

Open-Meteo documents that the returned coordinate is the center of the selected grid cell and may be kilometres away from the requested point. It also uses elevation-aware cell selection and statistical downscaling by default, and may automatically combine the “best suitable” models. Those details are model inputs, not incidental metadata: <https://open-meteo.com/en/docs>.

### Sampling model

`sampleWeather`:

1. finds the two anchors bracketing route distance;
2. samples each anchor at the arrival time using linear interpolation between adjacent hourly entries;
3. linearly blends those two time-interpolated values by route distance;
4. converts wind speed/direction to east/north flow components before both blends and converts the result back.

The operation is bilinear in route-distance/time for most scalar variables. It clamps distance to endpoint anchors and time to endpoint hours. It assumes anchors and hourly timestamps are ordered, every hourly array is aligned and long enough, and time steps are positive.

### Downstream use

`computePlan` samples the weather field on the grade-adjusted route skeleton. Comfort and alerts consume the result. Alerts wisely scan raw categorical weather codes rather than interpolating them; this avoids turning a thunderstorm code into a fictional continuous value. However, alerts still inherit anchor selection, model seams, time-window interpretation, and provider-horizon issues.

Mobile prefetches and retains a route-keyed field once per route unless explicitly retried. Web stores only the selected route’s field and refetches whenever the selected route object changes, including when switching back to a previously viewed route. The API scheduler accepts database forecasts as fresh for 30 minutes, but a provider failure does not use a bounded stale-if-error fallback. None of these paths attach a forecast-validity state to computed plans.

### Existing tests

`weather.test.ts` verifies:

- exact and midpoint linear interpolation;
- clamping outside the time and anchor ranges;
- scalar precipitation interpolation;
- the 350°/10° wind wrap;
- cancellation of equal opposing winds.

`interpolate.test.ts` validates route-space and grade-adjusted arrival-time behavior. `plan.test.ts` covers summary/recommendation behavior and categorical safety alerts. The tests are useful unit checks but mostly prove the implementation matches itself. They do not validate provider contracts, temporal semantics, forecast skill, calibration, missing data, malformed arrays, model seams, terrain, duplicate grid cells, or recommendation stability.

## Critical failure modes

### Severity summary

This document uses **critical** for a semantic corruption that can turn missing/expired/interval data into a confident decision input, **high** for a material accuracy or provenance gap, and **medium** for bounded ambiguity or robustness debt. This scale is local to the weather algorithm and does not imply Algorithm 7's P0 safety definition.

| Severity | Failure                                                                            | Consequence                                                                         | Immediate stance                                                             |
| -------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Critical | A missing precipitation probability becomes 0                                      | A dry recommendation can be created from absent data                                | Preserve null/unknown; never score it as certainty                           |
| Critical | Time outside the field silently clamps                                             | Expired forecasts look current and can drive alerts/recommendations                 | Reject or explicitly mark extrapolated/unavailable                           |
| Critical | Variable validity semantics are ignored                                            | Hourly sums/maxima are treated as instants; rain and gust timing is shifted/smeared | Introduce per-variable sampling policies                                     |
| High     | Available cell metadata is discarded and source-model lineage is often unavailable | Results cannot be fully audited, deduplicated, or stratified                        | Persist available provenance; use explicit model/run snapshots when required |
| High     | Anchor placement ignores terrain/grid/model boundaries                             | False gradients, missed gradients, duplicate calls, cross-barrier blending          | Replace fixed distance count with adaptive planner                           |
| High     | No uncertainty or calibration                                                      | Small score differences become falsely decisive recommendations                     | Add uncertainty and rank-stability outputs                                   |
| High     | Client/server freshness behavior diverges                                          | Users and scheduled watches can see different “best” starts                         | Centralize validity/freshness policy                                         |
| Medium   | Linear vector interpolation can fabricate calm                                     | A rotating or frontal wind can cancel midway                                        | Preserve vector method, add ambiguity/temporal-resolution handling           |
| Medium   | First-anchor timezone represents the entire route                                  | Cross-zone routes can be labeled or scheduled incorrectly                           | Treat display/schedule timezone separately from forecast UTC                 |
| Medium   | Input shape assumptions are unchecked                                              | Partial or changed provider responses cause NaN or exceptions deep in planning      | Validate at adapter boundary                                                 |

### 1. Temporal semantics are wrong by construction

Open-Meteo identifies most temperatures, humidity, cloud, and wind as instantaneous at the indicated hour. It identifies precipitation as a **sum of the preceding hour**, gust as the **maximum of the preceding hour**, and precipitation probability as the probability that the preceding hour exceeds 0.1 mm. Directly interpolating all of these as point values changes their meaning. See the provider’s variable table: <https://open-meteo.com/en/docs#hourly-weather-variables>.

Examples:

- Interpolating precipitation totals `[0, 2]` to 1 mm at the midpoint suggests a changing instantaneous intensity, but the “2” belongs to an interval. It can move apparent onset by half an hour and does not conserve interval totals when samples are integrated.
- Interpolating gust maxima assumes a smooth maximum between two disjoint aggregation windows. A maximum is not a continuous state.
- Interpolating probability creates false precision. A 50% value between 20% and 80% may be a usable display approximation, but it is not a probability derived from an ensemble at that location and interval.
- The alert overlap logic and sampled comfort can describe different rain timing because one reads raw hourly intervals and the other reads lerped values.

Required correction: every normalized variable must declare `validity = instant | intervalMean | intervalSum | intervalMax | categorical | probability`, interval bounds, native step, missingness, and a sampling policy.

### 2. “Unknown” is silently rewritten as “dry”

`toSeries` maps a null precipitation probability to zero. The comment correctly notes that null may occur beyond the probabilistic horizon; the implementation then assigns the strongest possible dry claim. This is a material recommendation defect.

Unknown probability should remain unknown. Policy choices are:

- exclude rain probability from scoring and lower confidence;
- use deterministic precipitation as a clearly labeled fallback;
- use a calibrated climatological/base-rate prior, never zero;
- shorten the recommendation horizon to the probability horizon.

The selected policy must be visible in the plan’s confidence/reasons and measured in backtests.

### 3. Silent clamping hides stale and incomplete data

Clamping is convenient for UI continuity and dangerous for decision support. A start time one minute beyond the field receives the last forecast indefinitely. The existing test explicitly canonizes this behavior.

Replace it with a result carrying:

- `available`: interpolation is fully within supported bounds;
- `degraded`: a bounded, declared fallback was used;
- `unavailable`: the plan cannot claim weather for this sample;
- `reason`: before horizon, after horizon, missing variable, stale issue time, provider failure.

A short grace interval may be legitimate for instantaneous variables because provider timestamps can be interval centers/bounds. It must be variable-specific and tested, not unbounded clamping.

### 4. Anchor density does not correspond to information density

The 2.5 km rule looks precise but may add no information. Model grids range from roughly 1–50 km, and precipitation probability is documented as based on a roughly 27 km ensemble grid. Eight route anchors can therefore resolve to the same source cell while appearing independent. Conversely, a route beyond 17.5 km hits the eight-anchor cap and spacing expands without disclosure. Open-Meteo also states that the returned grid-cell center may be kilometres from the request: <https://open-meteo.com/en/docs>.

Distance spacing misses the places where anchors matter:

- sharp elevation changes;
- opposite sides of a ridge;
- land/water transitions;
- urban/rural transitions;
- boundaries between regional and global models;
- a route leaving and re-entering a convective cell;
- long routes after the eight-anchor cap.

It oversamples:

- short folded routes where route-distance-separated anchors share a grid cell;
- loops and out-and-backs whose physical coordinates repeat;
- spatially uniform fields at resolutions coarser than the route.

### 5. Along-route linear interpolation is not a meteorological spatial model

Route distance is a valid index for the runner’s journey, but it is not a spatial coordinate. A midpoint by route distance need not be geographically midway between its two anchors. On loops, switchbacks, ferries, bridges, valleys, and out-and-backs, the two bracketing anchors can be a poor basis for the current physical point.

Linear blending also crosses barriers with no understanding of:

- elevation/lapse rate;
- terrain exposure and channeling;
- coastlines and lake breezes;
- land-cover roughness;
- model-cell discontinuities;
- fronts and convective boundaries.

Do not replace this immediately with a more ornate interpolator over the same sparse, opaque inputs. First use returned grid-cell identity, elevation, model resolution, and physical distance. An inverse-distance or triangulated interpolator is only justified when there are genuinely distinct, compatible spatial samples.

### 6. Automatic model choice can create seams

Open-Meteo says its default combines the best suitable models and selects high-resolution applicable data for each location. Adjacent anchors near a regional-model boundary can therefore have different sources. The API’s model-update documentation also notes eventual consistency across servers and that underlying native temporal resolution may be 3 or 6 hours even when output is interpolated hourly: <https://open-meteo.com/en/docs/model-updates>.

Blending across a model seam is not necessarily wrong, but it is not equivalent to interpolation within one coherent field. With Best Match and no exact source lineage, Runcast cannot:

- reproduce a recommendation;
- detect a seam;
- know whether an “hourly” transition contains provider-side interpolation;
- compare forecast changes between refreshes;
- attribute a regression to provider/model/engine.

### 7. Elevation is available locally but not controlled in the request

Route points carry elevation. Open-Meteo uses a 90 m DEM for cell selection and statistical downscaling unless elevation is supplied. A GPX elevation may itself be noisy, but ignoring the mismatch is especially costly on peaks, valley trails, cliffs, and ski-area roads. Provider docs explicitly allow per-location elevation and warn that the chosen grid cell depends on it: <https://open-meteo.com/en/docs>.

The adapter should record requested route elevation, provider-resolved elevation, their difference, and whether provider downscaling was used. Use a smoothed/validated route elevation, not raw spikes. Large differences should trigger an anchor or confidence warning.

### 8. Wind-vector interpolation is mathematically sensible but over-interpreted

Converting meteorological “from” direction plus speed into east/north flow components is the correct baseline. It handles 359°/0° and weights direction by speed. Keep it.

However:

- equal opposing winds cancel to calm at the midpoint; that may represent a vector mean, but it can also hide an unresolved frontal shift;
- direction is meaningless near calm, yet output normalizes it to 0°;
- 10 m model wind is not runner-height wind and does not capture street/forest/terrain roughness;
- an hourly field may already be interpolated from 3–6 hourly native output;
- gust is not a vector state and must not inherit assumptions from sustained wind.

Return wind-vector magnitude, direction only above a calm threshold, and an ambiguity indicator based on endpoint angular separation/native time step. Do not invent a sharp direction when the vector resultant is nearly zero.

### 9. Forecast uncertainty is absent

The engine produces one comfort number per candidate and selects the maximum. A difference of 0.002 is treated as decisively as 0.2. This is misleading when rain probability is coarse, forecast lead time is long, adjacent model runs disagree, or candidates are within the same uncertainty band.

Open-Meteo exposes ensemble models with materially different spatial/temporal resolutions and member counts: <https://open-meteo.com/en/docs/ensemble-api>. A full ensemble at every anchor may be too costly, but uncertainty must enter the architecture:

- member/quantile spread for high-impact variables where available;
- run-to-run change as a fallback uncertainty signal;
- lead-time- and region-calibrated error models;
- candidate win probability or “indistinguishable best window” rather than a brittle argmax;
- low-confidence status when critical variables are missing or mixed across models.

### 10. Cache policy is not forecast-validity policy

The server’s 30-minute freshness TTL is simple but unrelated to model update cadence, issue time, forecast horizon, or provider availability. Mobile can keep a prefetched field for the lifetime of its mounted state; web refetches on route reselection. Provider failure discards the opportunity to use a bounded stale forecast with an explicit badge, while silent endpoint clamping already uses unbounded stale values invisibly.

The provider documents both update schedules and eventual consistency; refresh should be based on run identity/age and use case, not one global timer: <https://open-meteo.com/en/docs/model-updates>.

Required distinctions:

- **cache age**: when Runcast fetched it;
- **forecast issue/run age**: when the model was initialized;
- **valid time**: the time being predicted;
- **lead time**: valid time minus issue time;
- **freshness policy**: when to seek a newer run;
- **stale-if-error policy**: when an older run is still safer than no result;
- **engine compatibility**: normalized schema/engine version.

## Target architecture

### 1. Provider response as an auditable artifact

Introduce a provider adapter boundary:

```text
Route + requested window
  -> AnchorPlanner
  -> ProviderRequest (coordinates, elevations, model policy, variables)
  -> RawProviderResponse (short-lived/debuggable)
  -> ContractValidator
  -> NormalizedForecastField + ForecastProvenance
  -> VariableSampler
  -> WeatherEstimate + Quality
  -> Plan/Recommendation
```

`ForecastProvenance` should include:

- provider and endpoint;
- normalized schema version;
- request hash and coordinate hash;
- requested coordinates/elevations and returned cell centers/elevations;
- timezone per location plus route display timezone;
- model selection policy and model identifiers if an explicitly selected endpoint exposes them;
- model initialization/run time when exposed, response computation duration, and fetch time, with unavailable provenance marked unknown rather than inferred;
- native temporal resolution when exposed and returned temporal resolution;
- valid-time bounds by variable;
- units from the response;
- missing-value counts;
- license/attribution identifier.

Store the normalized field snapshot needed to replay a Runcast decision exactly. Regenerating the same provider field later is a different requirement and needs an explicitly selected model/run or archived raw response; a live Best Match request alone is not reproducible.

### 2. Strict normalization and validation

Reject or explicitly degrade fields with:

- fewer than two timestamps for a policy that needs interpolation;
- unsorted, duplicate, or non-finite timestamps;
- array lengths that differ from time length;
- out-of-range humidity/cloud/probability;
- negative wind, gust, or precipitation;
- non-finite coordinates/elevations;
- unordered or duplicate route distances not explicitly deduplicated;
- units that differ from the expected contract;
- response locations that cannot be mapped unambiguously to requests.

Validation failures must occur at fetch/normalization, not as NaN inside comfort scoring.

### 3. Adaptive anchor planner

Use a staged planner rather than a fixed count:

1. Always include start, finish, and physically unique extrema needed for timezone/route bounds.
2. Add candidates where smoothed route elevation changes materially, where land/water class changes, and at maximum physical separation.
3. Deduplicate candidates that are geographically near each other, especially on loops/out-and-backs.
4. Request a modest first pass.
5. Deduplicate returned anchors by resolved grid-cell center/elevation and, only where exposed, model identity.
6. If adjacent distinct cells show a large, plausible gradient and the provider resolution can support refinement, add a bounded second-pass anchor.
7. Stop at a cost/latency budget and expose effective spatial resolution.

Candidate thresholds must be calibrated. A reasonable experiment starts with:

- maximum 5 km physical gap for high-resolution regional models, relaxed to one sample per distinct provider cell for coarse models;
- an extra elevation candidate for >150 m smoothed elevation difference or >100 m provider/route elevation mismatch;
- no more than 12 requested coordinates in the first production experiment;
- no second pass unless gradient/confidence gates justify it.

These are hypotheses, not acceptance criteria.

### 4. Variable-specific temporal samplers

Define policies:

| Variable                     | Provider semantics                      | Initial Runcast policy                                     | Longer-term option                                            |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Temperature, humidity, cloud | Instant                                 | bounded linear interpolation                               | monotone cubic only if validated; linear is likely sufficient |
| Sustained wind               | Instant vector                          | linear east/north components; nullable direction near calm | calibrated downscaling/roughness                              |
| Apparent temperature         | Instant derived value                   | interpolate as supplied; record provider formula/source    | recompute only if all components and semantics are controlled |
| Precipitation amount         | Preceding-interval sum                  | interval-overlap-conserving rate/amount                    | 15-minute native data where available                         |
| Precipitation probability    | Preceding-interval probability          | interval hold with unknown preserved                       | calibrated logit/ensemble estimate                            |
| Gust                         | Preceding-interval maximum              | interval hold or conservative overlapping maximum          | sub-hourly maxima                                             |
| Weather code                 | Categorical instant/interval descriptor | no numeric interpolation; nearest/interval set             | probabilistic hazards                                         |
| Radiation                    | Preceding-interval mean                 | interval hold or bounded interpolation labelled as mean    | 15-minute native/direct irradiance                            |

The sampler should return `value`, `support interval`, `quality`, and `source anchors`. For precipitation, tests must demonstrate conservation over interval overlap.

### 5. Spatial sampler aware of physical location and provenance

For a route sample:

1. find nearby distinct resolved provider cells using geodesic distance, not only route distance;
2. restrict blending to compatible model/run/native-resolution groups when known; otherwise mark lineage compatibility unknown and use a conservative baseline;
3. include an elevation adjustment only if its formulation and bounds are validated;
4. select nearest-cell rather than blend where the variable is categorical, cell semantics are incompatible, or the field crosses a declared seam;
5. return effective spatial support and interpolation distance.

Linear route interpolation can remain as a compatibility mode for simple point-to-point routes, but it should no longer be the only available model.

Avoid claiming “hyperlocal.” Output resolution should be the coarsest material source supporting the estimate, especially precipitation probability.

### 6. Explicit quality and uncertainty

Add a `WeatherQuality`/uncertainty object to samples and summaries:

- availability and degradation reasons;
- fetch age, issue age, lead time;
- effective spatial and temporal resolution;
- maximum distance/elevation mismatch to source cells;
- missing variables/fallbacks;
- model seam flag;
- deterministic or ensemble source;
- calibrated intervals/quantiles where available.

Recommendations should report:

- best candidate or best equivalence band;
- comfort distribution/interval, not only mean;
- probability each candidate is within a meaningful tolerance of best;
- sensitivity to weather refresh and interpolation mode;
- explicit safety override status.

### 7. Unified forecast cache service

Move request construction, validation, provenance, and freshness decisions behind one shared service/API for production clients:

- key by provider, model policy, coordinate/elevation request hash, requested valid window, variable set, and schema version;
- deduplicate concurrent requests;
- cache normalized fields and provider metadata;
- use model-aware soft expiry and bounded hard expiry;
- use stale-if-error only inside a declared horizon and mark results degraded;
- retain the last two run identities briefly to measure run-to-run volatility;
- prevent older async responses from overwriting newer ones;
- use jitter/backoff/circuit breaking around provider failures.

Direct client fetches may remain for local/demo development but should obey the same normalizer and validity model.

## Alternatives and trade-offs

### Keep fixed anchors, only repair semantics

Pros: smallest change, immediate correctness benefit, little extra cost.
Cons: terrain/model/grid issues remain.
Recommendation: do this first as Phase 0/1, but do not call it complete.

### Query every route skeleton point

Pros: simple conceptual mapping; provider selects cells.
Cons: many duplicate cells, higher payload/cost, public-service abuse risk, false precision, slower mobile requests.
Recommendation: reject for production.

### Pin one model globally

Pros: coherent field and reproducibility.
Cons: sacrifices superior regional models; one model is not best worldwide.
Recommendation: pin a regional policy per route/window where possible, record it, and compare with best-match in shadow mode.

### Nearest provider cell only

Pros: honest, reproducible, avoids blending model seams.
Cons: visible discontinuities; may ignore useful gradients.
Recommendation: valid fallback and baseline. Any interpolator must beat it out-of-sample.

### Inverse-distance weighting / triangulation / kriging

Pros: uses true geometry; supports multiple nearby anchors.
Cons: cannot restore sub-grid information; kriging covariance assumptions are variable/region-specific; elevation/barriers still matter.
Recommendation: trial inverse-distance/elevation-aware methods only after distinct-cell metadata exists. Reject complexity without measured lift.

### Full ensembles at every anchor

Pros: direct uncertainty and hazard probabilities.
Cons: payload, latency, cache, and commercial cost can multiply by member count.
Recommendation: ensembles at representative anchors or only for decision-sensitive/high-risk windows; propagate a calibrated error model elsewhere.

### Learned downscaling

Pros: possible local bias correction using elevation, coast, land cover, and observations.
Cons: data leakage, model-version drift, regional inequity, substantial MLOps burden, hard-to-explain safety behavior.
Recommendation: not before a reproducible historical-forecast evaluation pipeline and a strong simple baseline. Open-Meteo’s historical/previous-run products can support issue-time-correct backtests: <https://open-meteo.com/en/docs/historical-forecast-api>.

## Staged implementation plan

### Phase 0 — Define truth and stop silent corruption

- Document the supported forecast horizon and variable validity semantics.
- Preserve provider nulls; remove null-to-zero coercion.
- Replace unbounded time clamping with unavailable/degraded results.
- Add adapter contract validation and unit checks.
- Record returned coordinates/elevations/timezones, units, and response computation duration; mark forecast issue/model/run/native resolution unavailable unless an explicit endpoint provides them.
- Make plan/recommendation refuse a confident result when critical samples are unavailable.
- Add feature flags for strict sampling and legacy sampling.

Exit: no missing/stale value can masquerade as an observed zero or current forecast.

### Phase 1 — Correct temporal sampling and cache validity

- Implement interval-aware precipitation, probability, gust, and radiation policies.
- Retain vector interpolation for sustained wind with near-calm direction nullability.
- Align alert interval overlap with the same interval definitions.
- Introduce issue/fetch/valid/lead-time metadata.
- Centralize soft/hard expiry and bounded stale-if-error policy.
- Add concurrency deduplication and late-response protection.

Exit: unit/property tests prove temporal conservation and no out-of-horizon sampling.

### Phase 2 — Make anchors provider- and terrain-aware

- Pass validated/smoothed route elevation per requested anchor.
- Persist returned grid centers/elevations.
- Deduplicate physically repeated requests and identical returned cells.
- Detect cross-model/resolution seams.
- Add elevation/coast/physical-distance candidates behind a flag.
- Compare legacy, nearest-cell, and adaptive interpolation in shadow mode.

Exit: fewer redundant calls and lower spatial holdout error than fixed route-distance interpolation.

### Phase 3 — Quantify uncertainty

- Build historical forecast snapshots keyed by model run and valid lead.
- Add ensemble or run-to-run spread for decision-sensitive cases.
- Calibrate variable errors by region, season, lead time, terrain class, and model.
- Return candidate equivalence bands and rank stability.
- Separate safety confidence from comfort confidence.

Exit: uncertainty intervals and precipitation probabilities pass held-out calibration thresholds.

### Phase 4 — Advanced spatial correction, only if justified

- Evaluate elevation-aware residual correction and simple spatial interpolators.
- Evaluate runner-height wind adjustment by land-cover roughness.
- Consider learned post-processing only with issue-time-correct training and regional fairness review.
- Retire legacy field schema after compatibility window.

Exit: advanced method beats nearest-cell/adaptive-linear baselines on held-out routes without unacceptable reliability/cost regression.

## Data and calibration program

### Forecast archive

For every evaluated/scheduled forecast, retain a privacy-reduced record:

- rounded/tiled location or approved route cohort ID;
- provider/model/run/schema/engine versions;
- exact valid times and lead times;
- distinct returned cell metadata;
- normalized predictions and uncertainty;
- eventual verifying observation source;
- candidate ranking and selected start.

Use the provider’s **previous runs/single runs/historical forecast** data for backtesting at the forecast that would actually have been available; do not train or evaluate against a later analysis disguised as a forecast. Open-Meteo describes these distinctions here: <https://open-meteo.com/en/docs/historical-forecast-api>.

### Verification truth

Use multiple truth sources:

- quality-controlled station observations for temperature, humidity, sustained wind, gust, and precipitation;
- radar/gauge products for spatial precipitation where licensed;
- route-runner opt-in reports only as noisy secondary labels;
- provider analysis/historical forecast for coverage gaps, clearly separated from observations.

Station truth has representativeness error: airport wind does not equal wooded-trail wind. Score results by distance/elevation/land-cover match and do not hide sparse regions.

### Metrics

By variable:

- temperature/apparent temperature: MAE, bias, RMSE, interval coverage;
- wind speed/components: MAE and vector RMSE; direction error only above a speed threshold;
- gust: MAE, exceedance precision/recall, peak underprediction;
- precipitation amount: MAE plus event onset/offset error and equitable threat score;
- precipitation probability: Brier score, log loss, reliability diagram, expected calibration error;
- severe codes: recall is primary, with false-alert burden reported;
- spatial method: leave-one-anchor/cell-out error and elevation/coast strata.

For the product:

- top-choice regret relative to verified conditions;
- probability the recommended candidate is within the versioned meaningful-utility/regret threshold owned by Algorithms 6 and 7;
- refresh-to-refresh rank churn;
- fraction of plans degraded/unavailable;
- safety-alert miss rate;
- user-visible forecast age.

Report metrics by region, lead time, season, route length, elevation range, urban/rural/coastal class, and provider model. Global averages can conceal the routes where this model fails most.

## Validation and test plan

### Contract tests

- Recorded provider fixtures for one/many coordinates, multiple timezones, null probabilities, and shortened arrays.
- Verify response order mapping, units, returned cell centers, elevations, and timezone preservation.
- Fail on array-length mismatch, duplicate/unsorted time, NaN, negative precipitation/wind, invalid percentages.
- Golden request tests include coordinate/elevation rounding, exact forecast window, and model policy.
- Detect provider schema changes without silently accepting partial data.

### Property tests

- All bounded scalar samples remain within valid endpoint bounds.
- Wind components interpolate continuously; direction is null/stable near calm.
- 359°/1° never passes through 180°.
- Opposing endpoints set ambiguity and do not report a confident north wind at cancellation.
- Precipitation sampling conserves the amount of every source interval when integrated over that interval.
- Probability never leaves [0, 100] and unknown remains unknown.
- Gust sampling never creates a maximum greater than all contributing interval maxima unless an explicit conservative rule says so.
- No sample outside valid bounds reports `available`.
- Reversing route/field preserves weather estimates at mirrored physical points.
- Duplicating an identical resolved anchor does not change output.
- Anchor order permutation either normalizes safely or fails clearly.

### Golden scientific cases

- Front crossing with a 180° wind shift.
- Convective rain occupying one hourly interval.
- Mountain route with large route/provider elevation mismatch.
- Coastal route with returned land-cell displacement.
- Loop and out-and-back with repeated coordinates.
- Route crossing a model boundary.
- One-timestamp/shortened provider response.
- Forecast request spanning provider probability horizon.
- DST and cross-timezone route, while all sampling remains UTC.

### Backtests and field tests

- Rolling-origin evaluation: construct decisions only from runs available at each historical issue time.
- Hold out entire cities/terrain regions, not random points from the same grid.
- Compare legacy, nearest-cell, fixed distinct-cell, adaptive, and uncertainty-aware modes.
- Shadow recommendations for at least one warm, one cold, and one convective season before default rollout.
- For opt-in runners, compare start-time conditions with portable weather observations only under a documented sensor protocol; never treat subjective recollection as ground truth.

## Observability

Emit structured metrics without raw route coordinates:

- provider latency/status/retry/circuit state;
- request count, payload bytes, distinct requested coordinates, distinct returned cells;
- cache hit/stale-hit/miss and refresh reason;
- fetch age, issue age, lead time, and horizon margin;
- model/resolution mix and seam count;
- returned/requested elevation delta quantiles;
- null/invalid/clamped-attempt counts by variable;
- degraded/unavailable plan count and reason;
- interpolation distances and effective resolution;
- candidate score margin, equivalence-band width, and rank churn after refresh;
- severe alert counts and overrides.

Log a reproducibility ID connecting recommendation, normalized field, model run, anchor plan, and engine version. Route identifiers should be pseudonymous; exact coordinates must not enter routine logs.

Alerts:

- any silent-clamp counter above zero (it should be impossible);
- null-to-zero conversion above zero;
- provider contract failures;
- sudden returned-cell/model distribution change;
- p95 provider latency or error-rate breach;
- stale forecast used beyond hard expiry;
- severe alert disagreement between legacy and shadow modes;
- probability calibration drift.

## Rollout and rollback

1. Ship validation/provenance with output unchanged; measure provider irregularities.
2. Shadow strict temporal sampling and record plan deltas.
3. Enable strict missingness/horizon behavior for internal users, then 5%, 25%, 100%.
4. Shadow adaptive anchors against fixed anchors; cap request budget globally.
5. Roll out adaptive anchors by low-risk strata, excluding mountain/coastal/model-seam routes until validated.
6. Introduce uncertainty UI before allowing uncertainty to change recommendations.
7. Keep legacy normalization/sampling behind a server kill switch for one release window, but never re-enable null-as-zero or unbounded clamping.

Rollback must be schema-aware. A new normalized field cannot be read by an old engine unless compatibility is explicit. Persist engine/schema/model versions with scheduled recommendation snapshots.

## Measurable acceptance criteria

### Correctness gates

- 100% of missing provider values remain missing or use a named, observable fallback; 0 null-to-zero conversions.
- 0 plans claim full availability when any required sample lies outside variable validity bounds.
- 100% of normalized fields pass array alignment, monotonic-time, units, finite-value, and range validation.
- Precipitation interval conservation error <0.1% in property tests.
- Wind wrap/component tests pass at 10,000 randomized angle/speed cases; direction is absent below the chosen calm threshold.
- Raw categorical hazards are never numerically interpolated.

### Model-quality gates

- Adaptive/default spatial sampling beats nearest-cell and current fixed-route interpolation on held-out cell MAE for at least temperature and wind components, with no material precipitation calibration regression.
- Precipitation-probability Brier score improves over both current behavior and a lead-time/region climatology baseline; reliability error is reported and meets a pre-registered threshold (initial target: ECE ≤0.05 where sample size is sufficient).
- Nominal 80% uncertainty intervals cover 75–85% of held-out observations overall and are reported by stratum.
- Safety-event recall does not fall below the legacy raw-code scanner; target ≥95% for provider-predicted thunder/high-gust events in the benchmark.
- On held-out historical runs, ≥90% of recommendations either select the verified best candidate or satisfy the versioned meaningful-utility/regret threshold defined by Algorithms 6 and 7.

### Product/reliability gates

- ≥99.5% of valid forecast requests produce a validated field or an explicit degraded/unavailable state.
- Provider p95 fetch latency stays within the agreed budget (initial target: 2.5 s server-side, measured separately by region).
- Adaptive mode increases median requested coordinate count by no more than 50% and reduces duplicate returned-cell requests by ≥50% on loops/out-and-backs.
- Refresh-to-refresh recommendation changes are explainable by a new run or material input change; unexplained rank churn <1%.
- Exact route coordinates appear in 0 routine analytics/log events.

Targets must be revised only through a recorded decision with benchmark evidence, not relaxed after looking at a failing test set.

## Privacy, cost, licensing, and reliability

### Privacy

Weather requests reveal a sequence of route coordinates. Open-Meteo states that API logs can include geographic coordinates and are retained for 90 days: <https://open-meteo.com/en/terms>. A home-start route can therefore be sensitive.

- Prefer server-side aggregation so the provider sees service infrastructure rather than a runner’s IP.
- Query a minimal set of anchors and consider privacy-preserving tile/grid reuse where it does not reduce safety.
- Keep exact coordinates out of analytics and error messages.
- Define retention/deletion for raw provider requests and forecast archives.
- Obtain explicit opt-in for field observations or route-linked backtesting.

### Cost and terms

The Open-Meteo free service is limited to non-commercial use and published call-rate quotas; commercial Runcast use requires a suitable subscription or self-hosted/alternative arrangement. The current single multi-location call is efficient, but adaptive second passes, ensembles, and frequent refresh can materially change pricing and payload. See <https://open-meteo.com/en/terms>.

Build a cost model per:

- active route/day;
- watch refresh;
- requested location;
- ensemble member/variable;
- historical backtest;
- cache hit rate.

Enforce budgets in the anchor planner and scheduler.

### Reliability

The provider disclaims uninterrupted availability and forecast accuracy, and its distributed API is eventually consistent. Runcast needs:

- bounded retries with jitter;
- circuit breakers;
- cached validated stale-if-error fallback;
- run identity to avoid oscillating between server states;
- a secondary provider evaluation for safety-critical operations;
- a user-visible degraded/offline state;
- no safety guarantee language.

## Open decisions

1. What is the maximum decision horizon for recommendations when precipitation probability is absent?
2. Should production pin one coherent model per route or retain provider best-match and detect seams?
3. What route elevation source wins when GPX, provider DEM, and a future DEM disagree?
4. What error tolerance makes two candidate starts meaningfully equivalent?
5. Which variables justify 15-minute/native-resolution requests, and in which regions?
6. Are ensembles always sampled at representative points, or only when the deterministic ranking is unstable?
7. Is nearest-cell or elevation-aware interpolation the default baseline for model seams?
8. What bounded stale-if-error period is acceptable by lead time and hazard state?
9. Can forecast fetching be fully server-side without degrading interactive/offline use?
10. Which observation/radar sources can legally and consistently verify forecasts worldwide?
11. How will model/provider changes trigger recalibration and engine-version bumps?
12. What product language clearly communicates coarse precipitation resolution without overwhelming runners?

## Evidence and primary references

- Open-Meteo Forecast API: variable validity, multiple locations, elevation/downscaling, cell selection, returned grid centers, model selection, time horizons: <https://open-meteo.com/en/docs>
- Open-Meteo model update metadata, native resolution, and eventual consistency: <https://open-meteo.com/en/docs/model-updates>
- Open-Meteo ensemble models, members, resolution, and horizons: <https://open-meteo.com/en/docs/ensemble-api>
- Open-Meteo historical/previous/single-run guidance for issue-time-correct evaluation: <https://open-meteo.com/en/docs/historical-forecast-api>
- Open-Meteo terms, limits, warranty, and coordinate-log retention: <https://open-meteo.com/en/terms>

## Definition of done

This plan is complete only when Runcast can answer, for any displayed weather value or recommended start: which provider cell and, when available, model/run produced it; which source lineage remains unavailable; what time/space support it represents; whether anything was missing or interpolated; how uncertain it is; whether the forecast is still valid; and whether the recommendation is measurably better than a simple honest baseline.
