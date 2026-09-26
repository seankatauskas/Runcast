# Algorithm 7: Best-start recommendation improvement plan

Status: planning proposal; no production behavior is changed by this document.

Owners: Core engine, recommendation policy, API scheduler, mobile/web presentation

Primary code: `packages/core/src/engine/plan.ts`, `apps/api/src/jobs/scheduler.ts`, `apps/api/src/jobs/occurrences.ts`

Primary tests: `packages/core/src/engine/plan.test.ts`, `apps/api/src/jobs/occurrences.test.ts`; there is currently no direct scheduler recommendation/delivery test suite

Dependencies: Algorithms 1–6, especially Algorithm 3 hazard validity and Algorithm 6 safety/utility separation

Current delivery boundary: only the Algorithm 7 row in the
[program implementation commitment](README.md#current-implementation-commitment)
is active. The remaining phases and targets in this document are evidence-gated
design/research options, not current implementation scope.

## Executive assessment

The current best-start algorithm is small, deterministic, explainable, and appropriately cheap for an MVP. It evaluates the same `computePlan` pipeline used by the planner on a 30-minute grid and selects the candidate with the greatest mean comfort. That consistency is valuable.

It is not yet strong enough to support the product claim implied by “Best time,” especially when used for unattended watch notifications. The most important defect is that safety and preference are conflated incorrectly: severe-weather alerts are attached to a candidate summary, but the ranking ignores them. A thunderstorm candidate can therefore win if its comfort heuristic happens to exceed the alternatives. The algorithm also treats one deterministic forecast as truth, silently clamps beyond forecast coverage, has no confidence or abstention state, and can change its answer materially after small forecast updates.

The next version should be a constrained, uncertainty-aware decision system:

1. establish whether a candidate is evaluable;
2. apply explicit safety constraints;
3. rank the remaining candidates by robust utility rather than a single mean;
4. prefer stable recommendations when differences are immaterial;
5. return alternatives, confidence, and an honest “no suitable window” result.

This should remain deterministic and inspectable. Machine learning is not required for the next substantial improvement.

## Scope and dependencies

This document covers candidate generation, eligibility, ranking, uncertainty, explanations, persistence, and recommendation validation. It assumes the per-run plan remains the source of route conditions.

The recommender inherits errors from every upstream algorithm:

- route timing determines when samples encounter weather;
- weather interpolation determines candidate conditions;
- solar, canopy, and wind affect exposure;
- comfort determines preference utility;
- severe-condition detection determines safety eligibility.

Improving recommendation search without improving or representing upstream uncertainty would produce a more precise answer, not necessarily a more accurate one. The implementation should therefore consume explicit quality metadata from Algorithms 1–6 rather than infer that every `RunPlan` is equally trustworthy.

## Current implementation

The current `recommendStart` implementation in `packages/core/src/engine/plan.ts`:

1. generates starts from `windowStart` through `windowEnd`, inclusive, at exactly 30-minute increments;
2. calls `computePlan` for each start using one route, one constant speed, one weather field, and one coverage mask;
3. stores each candidate's scalar mean comfort and complete summary;
4. reduces the list by comfort, retaining the earlier candidate when scores tie;
5. returns all candidates and the winning timestamp.

The mobile planner evaluates roughly 48 hours on-device. The scheduler runs the same function for each recurring watch occurrence and persists the winner with `ENGINE_VERSION`. The scheduler refreshes route weather at most every 30 minutes and upserts the same occurrence snapshot on every eligible scheduler run—including after a notification has been sent—until the occurrence window is no longer returned. It also reevaluates the original full window after part of that window has elapsed, while delivery refuses to send once `now >= bestStart`. A watch can therefore choose an already-past winner that cannot be delivered, and a row referenced by an already-delivered notification can later change.

For `C` candidate starts and `S` route samples, ranking is approximately `O(C * S)` plus weather lookup costs. V1 work is bounded and appears inexpensive, but this must be profiled rather than assumed; finer grids and member-wise ensemble evaluation multiply the cost. Correct decision semantics are the immediate concern.

## What is already good

- **One engine:** interactive and server recommendations cannot drift merely because they use separate formulas.
- **Purity and determinism:** a result can be reproduced from its input snapshot and engine version.
- **Bounded work:** route sampling and candidate spacing bound mobile and scheduler cost.
- **Transparent baseline:** users and developers can understand why a cool, dry interval tends to win.
- **Candidate curve:** returning all candidates supports a useful time-versus-comfort visualization.
- **Versioned server snapshots:** `ENGINE_VERSION` is a sound starting point for migrations and audits.

These qualities should be preserved. The goal is a more rigorous decision contract, not an opaque optimizer.

## Critical failure analysis

### Severity definitions

- **P0:** can recommend outdoor activity during a condition the product itself identifies as dangerous.
- **P1:** can commonly choose the wrong window, communicate false certainty, or make server and user behavior unreliable.
- **P2:** meaningfully harms usefulness, explainability, maintainability, or performance but is unlikely to create immediate danger.

### P0 — alerts do not constrain the winner

`findAlerts` identifies thunderstorms, heavy rain, extreme heat, and high wind. `recommendStart` nevertheless compares only `summary.comfort`. There is no rule that rejects or demotes an alerted candidate. The notification layer notices alerts only _after_ a winner has been selected and changes its copy to “No favorable window found.” That is too late and can also be false: another candidate in the watch window may have had no alert.

This violates a fundamental decision-system invariant: a preference score must not override a hard safety rule. The National Weather Service advises postponing or canceling outdoor activities when thunderstorms are forecast and emphasizes that there is no safe outdoor location while a thunderstorm is in the area ([NWS lightning safety for outdoor sports](https://www.weather.gov/safety/lightning-sports)).

Required correction: classify every candidate as `ineligible`, `caution`, or `eligible` before comparing comfort. Never label an ineligible candidate “best.” If all candidates are ineligible, return a typed `no-suitable-window` result with reasons and the least-bad conditions only as context, not as a recommendation.

Do not promote the existing `findAlerts` booleans unchanged into hard eligibility. Its hourly overlap comparisons include buckets that end exactly at run start or begin exactly at run finish, and it treats a hazard at any weather anchor as applying to the run without locating the runner during that interval. Algorithm 3 must first define half-open interval semantics, spatial support, route/location matching, and hazard-specific lead/clearance buffers. Official area hazards, lightning proximity, and point precipitation do not necessarily share one domain rule.

### P1 — categorical weather codes are not authoritative warning coverage

The current safety scan is derived from hourly WMO forecast codes at sparse anchors. It does not consume official active alerts, radar/lightning proximity, flash-flood context, or hazard polygons. A “safe” output therefore means only “none of four local thresholds fired,” which is much weaker than the UI wording may suggest.

For the United States, NWS exposes watches, warnings, and advisories through CAP-compatible alert endpoints ([NWS Alerts Web Service](https://www.weather.gov/documentation/services-web-alerts)). Similar authoritative feeds differ by country. Until region-appropriate alert ingestion exists, the product must avoid claiming a candidate is safe. The state should be “no modeled hazard detected,” accompanied by forecast freshness and limitations.

### P1 — deterministic input is presented as a certain optimum

One provider-selected forecast trajectory produces one exact winning time. No uncertainty range, model spread, forecast age, or lead-time skill affects the result. A five-point difference between ensemble members can reverse adjacent candidates, especially around rain onset.

Open-Meteo exposes individual ensemble members as a probability distribution and also exposes ensemble means and spread ([Ensemble API](https://open-meteo.com/en/docs/ensemble-api), [Ensemble Mean API](https://open-meteo.com/en/docs/ensemble-mean-api)). Ensembles do not eliminate model error, but they allow the system to express that a nominal winner is fragile.

Required correction: rank using a distribution of outcomes where available and expose confidence. At minimum, treat old, incomplete, or rapidly changing forecasts as lower confidence and abstain when inputs are outside policy.

### P1 — forecast-boundary clamping creates false data

Hourly sampling clamps times before the first forecast value and after the last value. Recommendation has no input-validity metadata and does not verify that the _entire run_ fits inside the forecast horizon. A candidate can therefore be evaluated partly using a repeated endpoint value while appearing fully forecast.

Required correction: weather fields must expose `validFrom`, `validThrough`, model/run identity, and quality flags. Candidate eligibility must cover start through estimated finish, including any safety buffer. No ranking should silently extrapolate.

### P1 — scheduled winners can already be elapsed or unactionable

The watch scheduler passes an occurrence's original `windowStart` and `windowEnd` to `recommendStart` even after local time has entered that window. The recommender does not know the decision time. It can continue selecting an earlier, now-elapsed candidate; `deliver` then refuses to send because the selected start has passed. A nominally future recommendation can also provide less preparation time than the notification policy implies.

Required correction: recommendation input must include `decisionTime`, `minimumPreparationTime`, and delivery/actionability policy. Scheduled candidate generation must use an effective lower bound at or after `decisionTime + minimumPreparationTime`. If no future actionable candidate remains, return a typed result rather than persisting a past “best” start.

### P1 — the search grid is arbitrary and inconsistent with the UI

The recommender uses 30-minute starts while the interactive planner permits 15-minute steps. Short rain transitions, sunrise, sunset, heat peaks, and a long run crossing a forecast boundary can make the optimum occur between grid points. The result is also phase-dependent: if `windowStart` is 08:07, candidates occur at :07 and :37 rather than on understandable clock boundaries.

Required correction: define candidate alignment explicitly in the route timezone. Benchmark a 5-, 10-, and 15-minute exhaustive grid before adding search complexity. With at most 500 samples, a 15-minute 48-hour grid is only 193 candidates. If finer precision is useful, evaluate a coarse grid and refine around the top intervals and hazard boundaries.

### P1 — “window” semantics are ambiguous

The current range constrains start time only. A run may finish after `windowEnd`. Some users will interpret a watch window as “I can start during this period”; others mean “I must complete the run during this period.” The contract does not say which.

Required correction: make `windowPolicy` explicit:

- `start-within`: start must be inside the window;
- `finish-within`: finish must be inside the window;
- later, optional preparation and return buffers.

Watch creation and recommendation explanations must display the selected interpretation.

### P1 — average comfort hides short bad or dangerous stretches

Mean comfort can reward a candidate with mostly pleasant conditions and one acutely bad stretch over a consistently acceptable candidate. Sample comfort also clamps at zero, so the mean loses information about how far an underlying penalty exceeded the floor. A 5% route segment in a downpour can disappear inside a high average.

Required correction: use a score vector. Candidate assessment should include expected or deterministic mean, lower-tail comfort, minimum sustained comfort, worst contiguous segment, exposure duration above thresholds, and safety state. Ranking policy should be explicit and lexicographic where safety is involved.

### P1 — recommendation jitter is uncontrolled

The scheduler can recompute and overwrite an occurrence every 15 minutes, including after a delivery references that row. A small model update can move the winner between adjacent slots. There is no minimum meaningful improvement, hysteresis, immutable delivered snapshot, “locked at” time, or record of why the result changed. Users can open a notification whose persisted recommendation no longer matches its original title/body/data.

Required correction: compare a new result with the previously published result. Retain the old start unless the new candidate is materially better, changes safety tier, or the old candidate becomes infeasible. Lock notifications according to a documented lead-time policy while continuing to send safety escalations.

### P2 — tie handling is accidental policy

The reducer keeps the earliest exact tie, but floating-point near-ties are not treated as ties and no product rationale is recorded. A difference of `1e-8` can select a later time.

Required correction: define a meaningful indifference band based on validation, such as a comfort delta below which starts are equivalent. Within that band use declared preferences: stability, earlier/later, daylight, or closest to the user's usual time.

### P2 — no abstention, confidence, or alternatives

The return type requires a `best` timestamp. It cannot say that inputs are missing, every interval is hazardous, forecast disagreement is too high, or candidates are indistinguishable. It also cannot explain the cost of selecting the second-best time.

Required correction: make winner optional and return a status, confidence, ranked alternatives, and explicit reason codes.

### P2 — ranking and explanation are coupled to an unstable scalar

Candidate comfort is copied from `summary.comfort`, while the explanatory summary contains penalties and alerts. Once scoring evolves, clients may infer reasons differently. A winner explanation should be generated from the exact comparison policy, including counterfactuals such as “09:00 is slightly warmer but has much less rain risk.”

### P2 — no recommendation-specific evaluation harness

Current tests use synthetic fields to verify that a rainy afternoon or hot evening loses. They do not measure grid regret, hazard exclusion, forecast uncertainty, stability across model revisions, long-run boundary behavior, DST alignment, or real forecast skill.

## Target decision model

### 1. Typed input-quality gate

Every recommendation request should include or derive:

- weather validity interval, issue time, provider/model/run ID, and age;
- route/elevation/coverage quality flags;
- forecast lead time for each candidate;
- whether official alert coverage is available for the route region;
- speed uncertainty or a conservative duration range;
- window policy and route timezone;
- decision time, minimum useful preparation/notice time, and whether delivery is still actionable.

If required data is absent, return `unavailable` rather than manufacturing a score.

### 2. Candidate generation

Start with an aligned 15-minute grid. Use local-time display boundaries but represent all instants in UTC. Round inward by default: the first grid candidate is the first aligned instant at or after the effective lower bound, and the last is at or before the upper bound. Exact unaligned bounds are included only under an explicit policy. Handle repeated and nonexistent civil times through explicit timezone conversion, following the scheduler's existing DST discipline.

For scheduled watches, the effective lower bound is at least `decisionTime + minimumPreparationTime`; an already-elapsed start is never a candidate. Product policy must decide whether a late but still future start can be delivered when the configured lead time has already been missed.

For each candidate:

1. estimate conservative finish time using the slower end of the duration range;
2. reject candidates that are elapsed, unactionable, or violate window/forecast-validity policy;
3. compute the route plan;
4. optionally evaluate ensemble members or compact uncertainty scenarios;
5. derive safety, robustness, preference, and explanation features.

Only add adaptive 5-minute refinement if hindcast tests show material regret from the 15-minute grid. Refine around the leading feasible basins and known event boundaries, not only around one top point.

### 3. Safety eligibility

Use rule-based policy with versioned reason codes. An initial policy could be:

- `ineligible`: thunderstorm code overlap, applicable official warning, forecast coverage gap, or a product-approved extreme threshold;
- `caution`: elevated heat, gust, precipitation, low confidence, or incomplete authoritative-alert coverage;
- `eligible`: fully evaluated with no blocking rule.

Thresholds require clinical/meteorological review and must not be presented as universal medical advice. Safety logic needs its own version independent of comfort preferences.

### 4. Robust utility

Do not immediately collapse a candidate to one scalar. Retain:

- `expectedComfort`;
- `p10Comfort` or another lower ensemble quantile;
- `worstSegmentComfort` over a meaningful distance/time window;
- probability and duration of rain, high heat, and high wind thresholds;
- direct-sun and darkness fractions;
- forecast confidence and input completeness;
- distance from the user's preferred start;
- stability cost relative to a previously published recommendation.

Ineligible and unevaluable assessments are retained for explanation and audit but are not selectable. If no eligible or policy-permitted caution candidate remains, `best` is null. Suggested ordering within the selectable set:

1. eligible over policy-permitted caution;
2. lower probability/severity of non-blocking safety-relevant hazards;
3. higher lower-tail comfort;
4. higher expected comfort;
5. retain the previous recommendation within an indifference band;
6. apply the user's declared earlier/later preference;
7. deterministic timestamp tie-break.

This is deliberately lexicographic. A weighted sum invites a sufficiently pleasant temperature to compensate for lightning risk.

### 5. Honest output contract

A future contract should resemble:

```ts
type RecommendationStatus = 'recommended' | 'caution' | 'no-suitable-window' | 'unavailable';

interface EvaluatedCandidate {
  evaluation: 'evaluated';
  startTime: number;
  finishTime: number;
  eligibility: 'eligible' | 'caution' | 'ineligible';
  reasonCodes: string[];
  expectedComfort: number;
  lowerComfort: number | null;
  confidence: 'high' | 'medium' | 'low';
  summary: PlanSummary;
}

interface UnevaluableCandidate {
  evaluation: 'unevaluable';
  startTime: number;
  finishTime: number | null;
  eligibility: 'unknown';
  reasonCodes: string[];
  expectedComfort: null;
  lowerComfort: null;
  confidence: 'low';
  summary: null;
}

type CandidateAssessment = EvaluatedCandidate | UnevaluableCandidate;
type SelectableCandidate = EvaluatedCandidate & {
  eligibility: 'eligible' | 'caution';
};

interface RecommendationV2 {
  status: RecommendationStatus;
  best: SelectableCandidate | null;
  alternatives: SelectableCandidate[];
  assessments: CandidateAssessment[];
  evaluatedRange: { start: number; end: number };
  inputIssuedAt: number;
  modelVersion: string;
  safetyPolicyVersion: string;
  explanation: { headline: string; reasonCodes: string[] };
}
```

Clients should render status directly rather than reverse-engineering it from alerts.

### 6. Stability policy

Persist the full ranked assessment, not only the winner's summary. On refresh:

- immediately replace a recommendation if its safety state worsens;
- otherwise change the start only when improvement exceeds a validated threshold;
- record `supersedes`, old/new inputs, reason codes, and score deltas;
- never mutate a snapshot referenced by a delivered notification; write an immutable superseding evaluation;
- stop ordinary preference churn after the notification lock time;
- allow urgent safety retractions after lock.

## Alternatives considered

### Exhaustive fine grid

**Advantages:** simplest correctness story; deterministic; easy to benchmark.
**Disadvantages:** work grows linearly with window size and ensemble members.

This should be the benchmark and may remain the production approach. Do not introduce mathematical optimization until profiling shows a real need.

### Coarse grid plus local refinement

**Advantages:** supports 5-minute precision with less work.
**Disadvantages:** can miss a separate better basin or a narrow safe interval; more difficult to test.

Use only after comparing against an exhaustive oracle.

### Weighted single objective

**Advantages:** easy sorting and personalization.
**Disadvantages:** obscures tradeoffs and can compensate safety risk with comfort.

Acceptable only inside the preference tier after hard constraints are applied.

### Pareto frontier presented to the user

**Advantages:** honest when one time is cooler and another is drier.
**Disadvantages:** more UI complexity and no automatic watch answer.

Use internally to select diverse alternatives; still apply a documented default policy for notifications.

### Learned ranking

**Advantages:** could eventually model user choices.
**Disadvantages:** cold start, selection bias, privacy obligations, drift, poor safety explainability.

Defer until deterministic validation, feedback consent, and minimum cohort/data requirements are established. Never learn safety constraints from engagement.

## Validation program

### Deterministic and property tests

- winner is never an ineligible candidate;
- all-ineligible inputs return `no-suitable-window` with no winner;
- candidates earlier than the actionable lower bound are never generated or selected;
- a scheduler run partway through a watch window cannot select an elapsed start;
- no candidate whose conservative finish exceeds forecast validity is eligible;
- expanding a window cannot remove existing candidate assessments;
- identical inputs and policy versions produce byte-stable ordering;
- candidates within the indifference threshold follow the documented tie policy;
- DST fall-back creates two distinct instants only when product semantics allow them;
- spring-forward never invents a nonexistent local time;
- route reversal and equivalent weather transformations preserve appropriate recommendation invariants;
- NaN, empty ranges, malformed time arrays, and zero/invalid speeds return typed failures rather than reducer exceptions.
- hourly hazard boundary and spatial-support tests distinguish conditions that actually overlap the runner from adjacent/non-overlapping anchor intervals;
- a delivered snapshot is immutable; any later evaluation creates an auditable superseding record without changing notification history.

### Search-quality tests

Build an exhaustive one-minute or five-minute oracle for synthetic fields. Measure:

- **selection regret:** oracle utility minus chosen utility;
- **hazard regret:** any chosen candidate that the oracle policy marks ineligible;
- **boundary miss rate:** events beginning between normal grid points;
- **alternative diversity:** alternatives should not be trivial adjacent duplicates.

Establish the maximum tolerable regret before selecting grid/refinement policy.

### Hindcast evaluation

Use archived forecasts _as they were issued_, not reanalysis alone. Open-Meteo's Previous Runs API provides fixed lead-time forecasts for skill analysis, while its Historical Forecast and Single Runs products support broader reproduction ([Previous Runs API](https://open-meteo.com/en/docs/previous-runs-api), [Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api)).

Create a reproducible corpus stratified by:

- geography and provider model;
- coastal, mountain, urban, and flat terrain;
- season and daylight transition;
- run duration and route shape;
- precipitation, heat, wind, and calm cases;
- forecast lead time and model update cycle.

Compare the recommendation against observations or appropriate analysis data at route samples. Avoid using the same stitched “best match” series as both forecast and truth.

### Probabilistic calibration

For hazard probabilities, report reliability diagrams and Brier scores. Brier scoring measures squared error between forecast probability and observed event; ECMWF documents its use for probabilistic event verification ([ECMWF/WMO verification overview](https://confluence.ecmwf.int/spaces/WLS/pages/394992254/Verification)). Also measure discrimination, false-negative rate, and coverage/abstention rate. A well-ranked but uncalibrated probability must not drive safety copy.

### Stability evaluation

Replay successive model runs for the same occurrence and measure:

- number and magnitude of winner changes;
- time between last change and start;
- fraction of changes caused by safety versus marginal preference;
- utility lost by hysteresis;
- rate of recommendation retractions after notification.

The stability threshold should be derived from this tradeoff, not selected aesthetically.

### Field validation

With explicit consent, collect post-run reports tied to an immutable forecast snapshot:

- whether the runner started at the suggested time;
- perceived heat, sun, wind, and rain separately;
- whether conditions caused shortening, cancellation, or sheltering;
- actual start/duration from a user-provided activity when available.

Do not interpret “user ran anyway” as evidence that a hazardous candidate was safe. Preference feedback and safety outcomes must remain separate datasets.

## Observability and auditability

For each evaluation record:

- input snapshot IDs and hashes, provider/model/run, issue time, and valid range;
- engine, scoring, and safety-policy versions;
- number of generated, eligible, caution, ineligible, and unevaluable candidates;
- winner/alternative reason codes and score vector;
- evaluation duration and scenario/member count;
- prior recommendation and change reason;
- whether the output abstained.

Do not log raw private GPX coordinates. Use route IDs, coordinate hashes, aggregated quality flags, and region only where privacy policy permits.

Operational alerts should cover empty candidate sets, forecast-boundary rejection spikes, stale forecast use, evaluation latency, provider/model shifts, post-lock churn, and any invariant violation in which an ineligible candidate reaches delivery.

## Staged implementation plan

### Phase 0 — semantics and baseline corpus

1. Decide start-only versus finish-within window semantics.
2. Define decision-time, preparation-time, lead-time, and late-delivery semantics.
3. Define severity, eligibility, caution, and abstention terminology with product/legal review.
4. Create immutable recommendation fixtures and the exhaustive-grid oracle.
5. Instrument current recommendation churn and score margins without changing output.
6. Record the current engine as the baseline for hindcast regret.

Exit gate: product semantics and metrics are written; baseline corpus runs reproducibly in CI or a versioned evaluation job.

### Phase 1 — safety and input validity

1. Add forecast issue/validity metadata and stop silent out-of-range evaluation.
2. Filter elapsed/unactionable scheduled candidates and make delivered snapshots immutable.
3. Define hazard interval/spatial semantics, then extract versioned candidate eligibility from validated plan hazards.
4. Add typed `no-suitable-window` and `unavailable` states.
5. Update mobile and notification copy to render states directly.
6. Add official-alert integration behind region coverage flags where operationally supportable.

Exit gate: property tests prove that blocking candidates cannot be selected or delivered.

### Phase 2 — search precision and robust deterministic ranking

1. Align candidates to a documented 15-minute local-time grid.
2. Add lower-tail/worst-segment metrics and an indifference band.
3. Return diverse alternatives and comparison reason codes.
4. Benchmark exhaustive versus refined search on low-end supported devices and scheduler load.
5. Version and persist the full ranking contract.

Exit gate: selection regret and latency meet the thresholds below on the frozen corpus.

### Phase 3 — uncertainty and stability

1. Add ensemble mean/spread or selected member scenarios.
2. Calibrate event probabilities by region, lead time, and provider where data permits.
3. Introduce confidence, robust utility, and abstention thresholds.
4. Add hysteresis, lock time, supersession, and safety retraction flow.
5. Replay historical model runs before enabling watch notifications.

Exit gate: probabilistic calibration and churn improve materially without increasing hazardous selection.

### Phase 4 — preference personalization

1. Add explicit user controls for heat/rain/daylight preference and earlier/later tie-breaking.
2. Keep safety policy non-personalizable except for medically reviewed stricter limits.
3. Run preference changes through counterfactual explanations.
4. Consider learned calibration only after consented data and governance review.

Exit gate: personalization improves reported usefulness without degrading safety, calibration, or explanation fidelity.

## Proposed acceptance criteria

Final numbers should be frozen after the Phase 0 baseline, but release gates should include:

- zero selected candidates violating a versioned hard constraint across all unit, property, synthetic, and hindcast fixtures;
- zero scheduled winners at or before their actionable lower bound;
- zero mutation of a recommendation snapshot after its notification delivery references it;
- zero silent forecast extrapolation; every sample in an eligible candidate lies within declared validity;
- 99th-percentile recommendation latency within the agreed mobile interaction budget and scheduler service-level objective;
- 95th-percentile utility regret versus the exhaustive five-minute oracle below a documented small threshold;
- deterministic output for identical versioned inputs;
- every non-recommended result contains a machine-readable reason and user-safe explanation;
- probabilistic hazard outputs meet predefined Brier/reliability gates before confidence language ships;
- recommendation churn falls materially under replay without suppressing safety changes;
- the previous v1 contract remains readable during migration, with snapshots retaining their original semantics.

## Migration and rollout

- Introduce `RecommendationV2` alongside v1; do not silently change persisted JSON shape.
- Split `ENGINE_VERSION` into at least plan-model, recommendation-policy, and safety-policy versions.
- Shadow-compute v2 on mobile and scheduler without displaying or delivering it.
- Compare v1/v2 winner, safety state, regret proxy, latency, and churn.
- Enable v2 interactive display before push delivery; push has higher consequence and weaker user oversight.
- Roll out by deterministic cohort and region, constrained by official-alert coverage.
- Retain a kill switch that disables recommendations while leaving ordinary route forecasts available.

## Risks and explicit non-goals

- A better ranker cannot compensate for inaccurate route timing or weather fields.
- Ensemble spread is not total uncertainty; models can agree and still be wrong.
- Official alerts have geographic and temporal limitations and are not globally uniform.
- More alternatives can overwhelm users; diversity and explanation need usability testing.
- Personalization can encourage unsafe tradeoffs if it touches hazard eligibility.
- “Best” should not imply medical safety, guaranteed weather, or a unique mathematical optimum.
- Real-time nowcasting and lightning detection are separate capabilities; do not imply them from hourly forecasts.

## Open decisions

1. Does a watch window constrain start, finish, or both?
2. Which hazards are hard blocks, cautions, or informational, and who approves those rules?
3. Which countries can receive authoritative alert coverage at launch?
4. What confidence threshold causes abstention rather than a low-confidence recommendation?
5. How much utility improvement justifies moving a previously published start?
6. Should users choose an earlier/later tie preference?
7. What forecast/member volume is affordable for interactive and scheduled evaluation?
8. What language replaces “Best time” when model uncertainty makes several candidates equivalent?

## Recommended immediate decision

Prioritize Phase 1 before refining the grid or tuning comfort. Preventing alerted or unevaluable candidates from being called “best” is the highest-value correction in the seven-algorithm pipeline. Then establish the hindcast oracle and recommendation-specific metrics; without them, later scoring and search changes cannot be shown to improve real decisions.
