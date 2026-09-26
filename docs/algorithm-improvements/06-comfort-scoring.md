# Algorithm 6: Comfort scoring improvement plan

Status: proposed plan; no production implementation is authorized by this document.

Owners: core engine, recommendation policy, sports-science review, mobile/web product, privacy/data science.

Depends on: weather interpolation, solar/radiation exposure, runner-relative wind, route timing/grade, severe-weather alerts.

Current delivery boundary: only the Algorithm 6 row in the
[program implementation commitment](README.md#current-implementation-commitment)
is active. The remaining phases and targets in this document are evidence-gated
design/research options, not current implementation scope.

## Executive verdict

The current comfort score is an honest prototype heuristic implemented cleanly. It is not a validated measure of comfort, performance, physiological strain, or safety. The UI nevertheless renders it as an exact 0–100 number, plots a smooth daily curve, subtracts exact “penalty points,” and calls one start “best.” The mathematical precision exceeds the evidence.

Four design problems make weight tuning insufficient:

1. Open-Meteo apparent temperature already combines wind chill, humidity, and solar radiation, while Runcast adds separate sun and headwind penalties. The model can double-count the same environment.
2. A symmetric quadratic around 11°C treats equally distant cold and heat as equivalent. Running heat strain is asymmetric, strongly dependent on metabolic work, humidity, radiation, air movement, duration, clothing, acclimatization, and individual susceptibility.
3. Safety and preference share the same decision surface. A low average score cannot express “pleasant except for one dangerous interval,” and a high average score can create false reassurance.
4. The score has never been calibrated to what users report after real runs, and forecast uncertainty is absent.

The recommended target is a layered decision system, not a grander universal score:

- an explicit safety assessment with official-alert integration and conservative hazard policy;
- an environmental/physiological load estimate with uncertainty;
- an interpretable, calibratable preference or “conditions fit” model;
- a robust recommendation policy that never allows preference points to cancel a material hazard.

If a public 0–100 value remains, it must have a defined interpretation, such as the calibrated probability that this runner rates the conditions at least “good,” and it must be accompanied by uncertainty. Otherwise the product should use honest ordered labels and concrete tradeoffs.

## Current implementation and user contract

### Per-sample equations

packages/core/src/engine/comfort.ts defines an ideal apparent temperature of 11°C and computes:

\[
P_T = \operatorname{clamp}_{0,1}
\left(
\left(
\frac{F-11}{18}
\right)^2
\right)
\]

\[
P_S =
0.25\;I(exposure=sun)\;
\operatorname{clamp}_{0,1}
\left(
\frac{F-18}{10}
\right)
\]

\[
P_W =
0.2\;
\operatorname{clamp}_{0,1}
\left(
\frac{h}{8}
\right)
\]

\[
P_R =
0.3\;
\operatorname{clamp}_{0,1}
\left(
\frac{p}{100}
\right)
\left[
0.4 +
0.6\;
\operatorname{clamp}_{0,1}
\left(
\frac{q}{5}
\right)
\right]
\]

\[
C = \operatorname{clamp}_{0,1}
\left(1-P_T-P_S-P_W-P_R\right)
\]

where:

- \(F\) is Open-Meteo apparent or “feels-like” temperature;
- exposure is Runcast’s sun/shade/covered/night class;
- \(h\) is forecast ambient headwind component, not total runner-relative airflow;
- \(p\) is Open-Meteo's probability that the preceding-hour interval exceeds 0.1 mm at its forecast support scale, which Runcast currently interpolates as if instantaneous;
- \(q\) is Open-Meteo's preceding-hour precipitation sum in mm, which Runcast currently interpolates and feeds to a formula that treats the number like mm/h without interval-aware conversion.

Temperature, sun, headwind, and rain weights and breakpoints are hand-selected. The tests correctly lock these equations, clamping, and dominant-penalty behavior. They do not establish validity.

### Aggregation and recommendation

packages/core/src/engine/plan.ts:

- averages sample comfort arithmetically;
- averages each penalty arithmetically;
- selects the largest mean penalty above a 0.05 floor for explanation;
- evaluates starts every 30 minutes;
- chooses the first exact maximum because ties do not replace the accumulator;
- separately emits thunderstorm, heavy-rain, 35°C apparent-temperature, and 17 m/s gust alerts.

Sample averaging is approximately distance-weighted only because route resampling is approximately uniform. It is not a time integral, so a slow uphill kilometer and a fast downhill kilometer can contribute similar thermal burden despite different exposure times. Endpoints and any nonuniform sampling also affect the mean.

### UI claims

Mobile displays:

- an animated integer “/100 comfort”;
- “Limited most by heat/cold/sun/wind/rain”;
- “No major comfort tradeoffs” when no mean term clears the floor;
- a fixed-domain daily comfort curve;
- exact component deductions;
- “RECOMMENDED,” “You chose the best window,” and “+N comfort.”

Web has the same recommendation curve and penalty mechanics. The help screen appropriately says the model is simplified and not a safety guarantee, but a secondary disclaimer does not neutralize exact, confident language at the primary decision point.

## Critical findings

| Severity | Finding                                                                                                                                     | Consequence                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Apparent temperature already incorporates wind, humidity, and solar radiation, then Runcast adds sun and headwind again.                    | Double-counting is structurally possible, and the amount varies by provider/model implementation.                                            |
| Critical | One scalar mixes subjective comfort, expected performance, and safety-adjacent conditions.                                                  | Users can interpret a preference ranking as permission to run.                                                                               |
| Critical | The model ignores workload and metabolic heat production.                                                                                   | The same weather receives nearly the same thermal score for an easy 20-minute jog and a hard three-hour long run.                            |
| Critical | Heat and cold are symmetric around a marathon-derived 11°C ideal.                                                                           | This is physiologically unjustified and can make severe heat look like merely the warm mirror of cold.                                       |
| High     | Humidity, radiation, air movement, and wetness do not interact explicitly.                                                                  | Evaporative limitation, convective cooling, wet-cold stress, and solar load are misrepresented.                                              |
| High     | Wind only hurts as linear ambient headwind; crosswind and cooling are absent, tailwind cannot reduce cooling, and runner motion is omitted. | Both effort and thermal response can be directionally wrong.                                                                                 |
| High     | Mean sample score hides short hazardous or miserable stretches.                                                                             | Averages can wash out a bridge gust, exposed climb, downpour, or late-run heat peak.                                                         |
| High     | No forecast uncertainty or model disagreement reaches the score.                                                                            | A 73 and a 77 can appear meaningfully different when plausible conditions reverse the order.                                                 |
| High     | A fixed score floor creates broad zero-score ties.                                                                                          | The recommender then chooses the earliest tied candidate without acknowledging indifference.                                                 |
| High     | No personal preference, clothing, acclimatization, age-related vulnerability, medical context, or prior response is represented.            | “Comfort” is presented as universal when individual variation is large.                                                                      |
| High     | Precipitation probability and amount are multiplied without a provider-specific probabilistic interpretation.                               | The product conflates event probability, expected amount, conditional intensity, and user risk attitude.                                     |
| High     | Missing precipitation probability is coerced to 0 before comfort scoring.                                                                   | Unknown provider coverage becomes a confident dry contribution and can improve a recommendation.                                             |
| High     | Out-of-horizon weather silently clamps to endpoint values.                                                                                  | Comfort can remain precise-looking after forecast validity ends.                                                                             |
| High     | Safety coverage is incomplete.                                                                                                              | Cold/wet exposure, ice, flooding, air quality, official watches/warnings, and duration-sensitive heat risk are not in the decision boundary. |
| Medium   | The dominant mean penalty is a lossy explanation.                                                                                           | Interactions disappear, ties are order-dependent, and a localized dominant problem may not be named.                                         |
| Medium   | Exactly 0.05 is not dominant because comparison is strict.                                                                                  | A displayed score of 95 can still produce “No major comfort tradeoffs.”                                                                      |
| Medium   | Penalties can sum above one while score clamps to zero.                                                                                     | Different very bad candidates become indistinguishable and exact component deductions no longer reconcile visibly with the score.            |
| Medium   | Shade, covered, and night share no benefit except avoiding the sun penalty.                                                                 | Cold direct sun, hot radiative shade, canopy humidity, and nighttime safety/context are reduced to one binary.                               |
| Medium   | No explicit missing-data behavior exists.                                                                                                   | A valid-looking score can survive unknown canopy, coarse forecast resolution, stale data, or unsupported variables.                          |
| Medium   | Fixed population weights are not versioned independently from ENGINE_VERSION.                                                               | Calibration and rollback become opaque.                                                                                                      |

Open-Meteo states that apparent temperature combines wind chill, relative humidity, and solar radiation ([forecast documentation](https://open-meteo.com/en/docs)). Therefore the current score’s separate sun and wind terms are not clean independent explanations even if they happen to improve rankings on some days.

## What “comfort” must mean

Do not implement a new model until the team selects an explicit estimand. Plausible targets are different:

1. subjective thermal sensation during the run;
2. overall weather satisfaction after the run;
3. probability the runner would choose those conditions again;
4. expected pace/effort impact at a fixed physiological effort;
5. physiological heat/cold strain;
6. risk of a defined adverse event.

No single scalar faithfully answers all six. The recommended product contract is:

### Safety assessment

Categorical, conservative, and not offsettable by pleasant conditions. It answers: “Are there forecast hazards or runner-context reasons to avoid, shorten, delay, or modify this run?”

### Conditions fit

Personalizable and calibrated. It answers: “Given the user’s intended run and stated preferences, how likely are these conditions to feel acceptable?”

### Performance load

Optional and separate. It answers: “How might weather change effort or pace relative to the same route in benign conditions?” It should not be branded as comfort.

### Explanation and uncertainty

Concrete: warm direct radiation late in the run, likely rain, strong aerodynamic resistance on an exposed segment, or substantial forecast disagreement. An interval and confidence reason are more honest than unexplained precision.

## Safety must be a separate policy layer

### Heat

Heat risk should consider at least air temperature, humidity or vapor pressure, radiation, wind at runner height, exertion, duration, clothing, acclimatization, and vulnerable-state disclosures the user chooses to provide. Exertional heat stroke arises from metabolic heat plus environmental load and can occur outside obviously extreme weather ([NATA position statement](https://pmc.ncbi.nlm.nih.gov/articles/PMC4639891/)).

Wet-bulb globe temperature is a defensible environmental screening input because it combines temperature, humidity, radiation, and air movement. It is not an individual heat-strain prediction and should not be treated as a universal cutoff. Consensus guidance explicitly cautions that WBGT is environmental stress, not human strain, and recommends sport/context-specific countermeasures ([Consensus Recommendations on Training and Competing in the Heat](https://pmc.ncbi.nlm.nih.gov/articles/PMC4473280/)). The NWS likewise describes WBGT as direct-sun heat-stress guidance based on temperature, humidity, wind, sun angle, and cloud cover ([NWS WBGT explanation](https://www.weather.gov/btv/heat)).

Use an authoritative gridded WBGT forecast where coverage and resolution are suitable, or validate one documented calculation against reference implementations and observations. Never silently substitute ordinary heat index: NWS heat index is aimed primarily at light activity in shade, and full sun may add up to 15°F ([NWS heat guidance](https://www.weather.gov/ctp/heat)).

Safety severity should trigger actions, not point deductions:

- official alert/watch/warning and source;
- avoid or reschedule;
- reduce intensity/duration and seek shade/cooling;
- carry hydration while avoiding prescriptive medical dosing;
- special caution if unacclimatized or recently ill, without asking users to disclose diagnoses.

Acclimatization may modify guidance and confidence but must not erase severe environmental warnings. CDC/NIOSH describes acclimatization as a gradual 7–14 day adaptation and notes fitness differences ([CDC/NIOSH recommendations](https://www.cdc.gov/niosh/heat-stress/recommendations/)).

### Cold and wet

Cold safety needs runner-relative airflow, exposed-skin wind chill, precipitation/wet clothing, duration, remoteness, and the consequences of being forced to stop. The NATA cold-injury statement says individual response varies with cold, wetness, wind, clothing, and exposure time and specifically notes that running-generated airflow is absent from ordinary environmental wind speed ([Environmental Cold Injuries](https://pmc.ncbi.nlm.nih.gov/articles/PMC2582557/)).

Add cold-risk guidance and explicit data gaps before claiming a general safety layer. Do not equate “cold discomfort” with frostbite or hypothermia risk.

### Precipitation and storms

For Runcast's current provider, precipitation probability applies to the preceding hour, uses a >0.1 mm event threshold, and is based on an ensemble support scale much coarser than a route sample ([Open-Meteo forecast documentation](https://open-meteo.com/en/docs#hourly-weather-variables)). The general user-facing concept is a chance of measurable precipitation for a point/period, not “percent of the route” ([NWS probability explanation](https://www.weather.gov/lmk/pops)); NWS thresholds/support are educational context, not Runcast's provider contract. Preserve:

- probability of an event;
- expected/forecast amount;
- convective or categorical severe-weather code;
- ensemble exceedance probabilities where available;
- surface and access hazards when data exist.

Lightning, flooding, freezing rain/ice, and high wind should remain explicit hazards. A utility model must not learn to trade them for cooler temperatures.

### Scope boundary

Air quality, wildfire smoke, pollen, darkness/personal security, trail access, flood depth, and ice are important but need their own reliable inputs and policies. Until implemented, the UI must disclose that “weather suitability” does not cover them.

## Proposed environmental and workload model

### Stop using apparent temperature as an additive base

Use primitive variables once:

- air temperature and dew point/vapor pressure or humidity;
- direct/diffuse shortwave radiation or a validated radiation estimate;
- longwave/mean-radiant approximation if feasible;
- runner-height apparent airflow from [Algorithm 5](05-runner-relative-wind.md);
- precipitation probability, type, amount, and gust scenario;
- shade/canopy/sky-view state with uncertainty;
- surface/terrain context where available.

Apparent temperature may remain as a display datum and benchmark. It should not be the base of a model that separately adds its ingredients.

### Represent intended workload

The minimum useful context is:

- expected duration and route-time profile;
- local speed and grade;
- intended effort category: easy/recovery, steady/long, workout/race;
- optional heat acclimatization and clothing coverage;
- optional user preference, not inferred medical vulnerability.

Absolute pace does not identify intensity across runners. A 5 min/km pace can be easy for one user and maximal for another. Ask for a low-burden intent selection or infer from a training integration only with explicit consent and an editable result.

### A transparent heat-balance proxy

The physiological scaffold is:

\[
S = M - W - E - C - R - K
\]

where metabolic heat \(M\), external work \(W\), evaporative loss \(E\), convection \(C\), radiation \(R\), conduction \(K\), and heat storage \(S\) evolve over time.

A consumer app will not know sweat rate, clothing permeability, skin temperature, or individual running economy accurately enough for a clinical heat-strain calculation. Use this balance to enforce correct interactions and directionality, not to imply core-temperature precision.

Recommended first implementation:

- broad metabolic-load priors by intended effort, pace, and grade;
- vapor-pressure-based evaporative capacity;
- radiation term from exposure and forecast radiation;
- convection from runner-relative airflow;
- time integration and recovery when conditions improve;
- explicit uncertainty ranges for personal parameters.

Compare this proxy against WBGT and UTCI for sanity, but do not substitute either as “runner comfort.” UTCI combines temperature, humidity, wind, radiation, a thermophysiological model, and an adaptive clothing model, but its reference activity/clothing assumptions are not hard distance running ([UTCI overview in BAMS](https://journals.ametsoc.org/view/journals/bams/98/12/bams-d-16-0082.1.xml)).

### Interpretable conditions-fit model

Use a constrained generalized additive or ordinal mixed-effects model rather than another fixed weighted sum:

\[
\eta_{r} =
\alpha +
b_r +
f_T(T, effort, duration) +
f_E(evaporative\ capacity) +
f_R(radiant\ load) +
f_A(aerodynamic\ load) +
f_P(precipitation) +
f_{interactions}
\]

where \(b_r\) is a shrinkage-controlled runner preference effect. Required interactions include:

- heat × humidity/evaporative capacity;
- temperature × airflow, because wind can cool while adding effort;
- cold × airflow × wetness;
- radiation × temperature;
- effort × duration × heat;
- precipitation type/intensity × temperature;
- grade/local pace × time under exposure.

Prefer monotone constraints only where physiology and the chosen target support them. Subjective preference can be nonmonotonic. Preserve feature contribution explanations, but label interactions honestly; “heat and humidity” may be the cause, not one winning penalty.

If a number is retained, anchor it to an observed outcome. For example:

\[
score = 100 \times
P(\text{runner rates overall conditions good or better})
\]

This gives calibration a testable meaning. Without sufficient personal history, use a population prior and display wider uncertainty. Do not pretend 73 versus 75 is actionable.

## Time, route, and uncertainty aggregation

### Integrate by time

Thermal burden should use elapsed time:

\[
\bar{x}_{time} =
\frac{1}{T}
\int_0^T x(t)\,dt
\]

Use segment trapezoidal integration so resampling does not change the result. Distance-weighted summaries may still be appropriate for route-story facts such as “miles in direct sun,” but they should not drive physiological exposure by accident.

### Preserve acute and cumulative effects

Return more than a mean:

- time-weighted typical conditions;
- peak and rolling 5/10/20-minute burden;
- cumulative heat/cold dose proxy;
- worst-decile or conditional-tail burden;
- location/time of the limiting stretch;
- recovery opportunities and finish-time state.

The route summary should never allow one excellent half to numerically cancel a hazardous half.

### Model correlated forecast uncertainty

Do not treat route samples or adjacent hours as independent rain/wind draws. Compute the full run for each ensemble member or coherent scenario, then summarize run outcomes. Open-Meteo documents direct ensemble mean/spread products with availability limitations ([Ensemble Mean API](https://open-meteo.com/en/docs/ensemble-mean-api)).

Return:

- median and central interval for conditions fit and load;
- probability of each hazard tier;
- probability each candidate beats the current start by a meaningful amount;
- forecast confidence reasons;
- model/personalization uncertainty separately where possible.

### Robust recommendation objective

Use a lexicographic or constrained decision rule:

1. exclude or clearly mark starts that violate safety policy;
2. among acceptable candidates, minimize material hazard probability;
3. maximize a conservative conditions-fit statistic, such as lower confidence bound or expected utility with tail penalty;
4. apply user constraints and time preference;
5. declare ties when improvement is below a meaningful threshold.

The UI should say “best forecasted tradeoff among these starts,” not “best window.” A later start should be recommended only when expected benefit exceeds uncertainty and the inconvenience threshold.

## Alternatives and tradeoffs

### Retune the four existing penalties

Fast and explainable, but it preserves double-counting, missing interactions, false symmetry, and an undefined target. Acceptable only as a temporary bug fix while vNext runs in shadow.

### WBGT-only score

Stronger for environmental heat screening than the current temperature term, but it covers neither cold nor rain/wind preference, and it is not individual strain. Use it in safety assessment, not as universal comfort.

### UTCI-only score

Broadly integrates thermal environment and is useful as a benchmark. Its reference activity and adaptive clothing model do not represent hard running, so it should not directly rank every run.

### Full thermophysiological model

Potentially mechanistic, but high input burden and false-precision risk are severe. A simplified, uncertainty-aware heat-balance proxy should earn its complexity before adding detailed core-temperature or sweat predictions.

### Pure machine learning

Can capture preferences but is weak under climate/runner shift, sparse cold/extreme cases, feedback-selection bias, and rare safety outcomes. Never use an opaque learned model to set hazard thresholds. Use constrained learning for preference residuals only.

### Remove the score entirely

Safest against false precision and viable for early rollout. Concrete factors, hazard tiers, and tied recommendation windows may serve users better than a number. Test this seriously rather than assuming a scalar is required.

## Staged implementation plan

### Stage 0 — Define, govern, and benchmark

- Choose the target outcome for any public score.
- Freeze the legacy formula and constants as an explicitly named model version.
- Inventory every score, penalty, dominant-factor, curve, recommendation, notification, persistence, and analytics consumer.
- Build a benchmark corpus spanning climate, season, latitude, run duration, effort, route exposure, and missing data.
- Establish human-factors review for safety language and sports-medicine review for hazard policy.
- Define data minimization, consent, retention, deletion, and model-card ownership before collecting feedback.

Exit: the team can reproduce every legacy result and can explain exactly what the successor will and will not claim.

### Stage 1 — Safety/utility separation and structural fixes

- Introduce a safety assessment independent of preference score.
- Integrate official alerts where licensing/coverage permit; retain raw categorical severe-weather scans.
- Add heat screening based on authoritative/validated WBGT and duration/effort context.
- Add cold/wet screening using runner-relative airflow and explicit limitations.
- Stop feeding apparent temperature plus separate wind/solar ingredients into experimental vNext.
- Add time-weighted, rolling-peak, and worst-stretch aggregation.
- Keep current recommendations unchanged while shadowing new outputs.

Exit: curated hazard cases cannot be improved away by preference, all unknown states are explicit, and double-counting is absent by construction.

### Stage 2 — Population conditions-fit model

- Collect structured, consented pilot labels with a pre-registered protocol.
- Fit an interpretable constrained model using primitive environmental variables and intended workload.
- Use route/day/runner grouped cross-validation and geographic/seasonal holdouts.
- Calibrate ordered labels or a defined probability score.
- Publish a model card with population, exclusions, uncertainty, performance by stratum, and known failure modes.
- Retain the legacy model as baseline, not as a teacher.

Exit: held-out ranking and calibration gates below are met without safety regression.

### Stage 3 — Coherent uncertainty and robust recommendations

- Run whole-plan ensemble/scenario evaluation.
- Separate forecast, route-exposure, and personal-model uncertainty.
- Add meaningful-difference/tie logic.
- Shadow compare candidate ranking, regret, recommendation churn, and lead-time behavior.
- Ensure severe but uncertain scenarios remain visible rather than averaged away.

Exit: uncertainty is empirically calibrated and marginal score differences stop causing recommendation changes.

### Stage 4 — Conservative personalization

- Start from the population prior.
- Let users directly state heat/cold/rain/wind preferences and intended effort.
- Update preference effects only after enough high-quality feedback, with hierarchical shrinkage and caps.
- Provide reset, inspect, export, and delete controls.
- Never personalize official alerts or hard hazard thresholds downward.

Exit: personalization improves within-runner held-out predictions, does not worsen sparse users, and passes privacy/fairness review.

### Stage 5 — UI, migration, and deprecation

- Test no-number, ordered-label, probability-with-range, and score-plus-range designs.
- Replace exact penalty subtraction with concrete contributions and interaction explanations.
- Show tied windows and confidence.
- Replace “best” and “no major tradeoffs” claims with calibrated language.
- Bump ENGINE_VERSION whenever rankings change; version safety policy separately.
- Dual-read stored legacy/new snapshots through the supported-client migration window.

Exit: comprehension studies show users distinguish comfort/preferences from safety and understand uncertainty.

## Research and field-validation program

### Pilot outcome collection

For consenting adults, collect immediately after a completed or abandoned run:

- overall weather satisfaction on a short ordered scale;
- thermal sensation from very cold to very hot;
- thermal comfort/acceptability;
- wind and precipitation burden separately;
- intended versus actual effort, using a simple perceived-exertion scale;
- whether the run was shortened, stopped, moved, or pace-modified because of conditions;
- clothing coverage and intentional cooling/water-dousing at broad categorical levels;
- optional heat-acclimatization self-description;
- whether forecast conditions materially differed from observed.

Avoid collecting diagnoses, medication, menstrual/reproductive status, precise body measurements, or symptoms in ordinary optimization telemetry. If a genuine safety-outcome study is needed, run it as separately consented health research with clinical/ethical and legal review; sparse product telemetry cannot validate rare severe-event thresholds.

### Instrumented sub-study

Use a smaller research cohort with:

- portable WBGT or component sensors;
- air temperature/humidity and globe/radiation measurement;
- runner-height airflow;
- synchronized route time, pace, grade, and exposure;
- heart rate only with separate consent and with recognition that it is affected by fitness, fatigue, and many confounders;
- structured sensation/comfort reports at intervals, not only retrospective finish ratings.

Compare forecast environmental error separately from response-model error. Otherwise the team will tune physiology coefficients to compensate for a biased forecast.

### Sampling and evaluation design

- Include easy, long, workout, and race-like efforts.
- Stratify by hot-humid, hot-dry, temperate, cold-dry, cold-wet, windy, and rainy regimes.
- Include short and multi-hour runs.
- Recruit beyond fast, healthy, highly engaged early adopters.
- Block folds by runner, route, day, city, and season as appropriate.
- Hold out entire climates/regions to measure transportability.
- Pre-register primary metrics and acceptable exclusions.
- Evaluate missing-data cases and forecast lead times independently.

Marathon studies show temperature/performance relationships and different optima by ability, but they do not validate an 11°C universal comfort optimum for all training. A large multi-race analysis found peak performance in a range that depended on performance level ([Impact of Environmental Parameters on Marathon Running Performance](https://pmc.ncbi.nlm.nih.gov/articles/PMC3359364/)); another discipline analysis found peak performance around 7.5–15°C WBGT in well-trained/elite events ([Effects of Weather Parameters on Endurance Running Performance](https://pmc.ncbi.nlm.nih.gov/articles/PMC8677617/)). These are benchmarks, not direct labels for recreational comfort.

## Verification plan

### Formula and property tests

- Primitive variables enter exactly once; apparent temperature is not combined additively with its own wind/radiation/humidity ingredients.
- Splitting/resampling a time segment does not change integrated outputs beyond tolerance.
- Extending an otherwise identical hot hard run cannot reduce cumulative heat load.
- Increasing humidity in a hot regime cannot improve evaporative capacity.
- Increasing runner-relative airflow can improve convective cooling while worsening aerodynamic load; explanations show both.
- Increasing wetness in cold/windy conditions cannot improve cold-risk tier.
- Direct radiation at the same air conditions cannot lower heat load.
- Hazard severity cannot be offset by preference contributions.
- All finite valid inputs produce finite bounded outputs; missing/invalid inputs produce explicit unknowns.
- Candidate ties remain ties under array ordering and small numerical perturbation.
- Reversing a route preserves environment where symmetric but changes wind/solar timing contributions where physically expected.
- Sample-count and endpoint changes do not alter time-integrated results materially.

### Reference implementation tests

- Verify WBGT or other adopted indices against published/reference calculators across their valid domains.
- Verify vapor-pressure, wet-bulb, radiation, and convection components independently.
- Maintain hot-humid, hot-dry, sunny-breezy, cold-wet, freezing-windy, storm, and benign golden cases.
- Include official-alert overlap boundaries and data-staleness cases.
- Have sports-science reviewers sign expected qualitative outcomes before model fitting.

### Model tests

- Calibration curves and expected calibration error overall and by effort, duration, climate, lead time, and personalization history.
- Pairwise candidate ranking accuracy and regret relative to user-reported preference.
- Ordinal log loss/Brier score against the legacy baseline and simple weather-only baselines.
- Geographic and seasonal transport performance.
- Ablation tests proving complexity adds held-out value.
- Stability under plausible forecast perturbations.
- Feature-attribution fidelity and interaction explanation tests.
- Drift detection as forecast providers/models change.

### UX comprehension tests

Users should correctly answer:

- whether a high conditions-fit value means the run is safe;
- whether two overlapping uncertainty ranges imply a meaningful difference;
- why a candidate was recommended;
- what hazards/data are not covered;
- whether “rain 40%” means 40% of the route;
- how intended effort and duration changed the result.

## Measurable acceptance criteria

These are release gates and should be finalized before looking at vNext results.

1. Every curated thunderstorm, official-warning, high-heat, extreme-cold/wet, and high-gust case triggers its expected safety tier; no preference contribution reduces that tier.
2. The adopted WBGT/reference environmental calculation agrees within 0.5°C across at least 99.5% of a dense valid-domain test grid and documents behavior outside that domain.
3. Time-integration metamorphic tests differ by less than 0.1 score point or the stricter scientifically relevant tolerance after 2× and 10× resampling.
4. On held-out pilot runs, vNext improves ordinal log loss by at least 10% and pairwise start-condition preference accuracy by at least 8 percentage points over legacy; 95% bootstrap intervals must exclude no improvement.
5. If the public score is a probability, expected calibration error is at most 0.05 overall, no adequately sized preregistered stratum exceeds 0.10, and the nominal 80% interval covers 70–90% of outcomes.
6. Personalized predictions improve within-runner held-out log loss by at least 5% after the minimum-history threshold and do not degrade cold-start users. Otherwise ship explicit preferences without adaptive learning.
7. Severe/worst-stretch cases that occupy at least five minutes are surfaced 100% in the golden corpus even when the run mean is benign.
8. Recommendation changes occur only when the probability that a candidate is meaningfully better exceeds the approved threshold, initially proposed as 75%; sensitivity at 60/80/90% must be reviewed.
9. In a preregistered comprehension study, at least 90% of participants understand that conditions fit is not a safety guarantee, and at least 85% correctly interpret overlapping uncertainty/tied windows.
10. Aggregate error gaps across adequately sized climate, effort, duration, age-band if voluntarily provided, and broad demographic strata do not exceed the approved fairness bound without documented mitigation or suppressed personalization.
11. The deterministic interactive path adds no more than 3 ms p95 for 500 samples on the reference mobile device; ensemble/scenario work does not block slider frames.
12. Model/provider/version provenance is present on 100% of persisted recommendations and feedback labels.

Safety outcome rarity makes “no observed incidents” an invalid launch criterion. Safety policy requires external evidence, expert review, adversarial cases, and post-release incident escalation even when consumer telemetry is quiet.

## Telemetry, privacy, and governance

### Minimum viable observability

Record:

- engine, preference-model, safety-policy, forecast-provider/model, and coefficient versions;
- forecast lead-time/confidence buckets and missing-input flags;
- aggregate old/new prediction, interval, hazard tier, and recommendation disagreement;
- broad intended effort/duration;
- whether a recommended time was selected;
- optional post-run labels listed above;
- latency, fallback, and calculation failure.

Do not record raw per-sample route, exact habitual start/location, health details, or wearable streams for ordinary product analytics. Compute features on device where practical. Research-grade traces require granular consent, a separate retention period, access/deletion controls, encryption, minimum cohort reporting, and a clear statement that declining does not reduce core functionality.

### Feedback-bias controls

Only completed runs generate ordinary post-run feedback, creating survivorship/selection bias. Also ask, without pressure, why a planned run was skipped, moved, shortened, or abandoned. Correct for exposure to recommendations, forecast error, and who chooses to respond. Do not optimize for recommendation acceptance; an overconfident system can inflate that metric.

### Governance

- Maintain model and safety-policy cards.
- Assign named owners for scientific review, provider changes, incident triage, and rollback.
- Revalidate when Open-Meteo source models or variable definitions change.
- Audit training data rights and consent.
- Prohibit safety-policy learning from engagement optimization.
- Establish a user-visible correction/contact path.

## Ethical and safety risks

- False reassurance is the primary harm. A polished 92/100 beside an alert or omitted hazard can be interpreted as permission.
- Personalization can encode survivorship: heat-tolerant users who continue running generate more labels than users who prudently stop.
- Vulnerable people may be underrepresented. The model must not infer that absence of complaints means safety.
- Fitness, age, disability, medications, pregnancy, recent illness, sleep, and acclimatization affect risk. Do not demand or infer these attributes; explain that the model cannot account for all personal factors.
- A “best time” can conflict with darkness, neighborhood safety, access hours, air quality, or official advice outside model scope.
- Hydration language must avoid one-size-fits-all medical dosing and the risk of overhydration. Give general preparation guidance and link authoritative advice.
- Never gamify running through warnings or reward users for tolerating extreme conditions.
- Keep raw feedback and precise routes out of advertising or unrelated profiling.
- Children require a separate policy and evidence base; default the product to adult guidance unless explicitly designed and reviewed otherwise.

The app’s existing disclaimer should remain, but safety must be expressed at the decision point, not only in help/legal copy.

## Rollout and migration

- Preserve the current result as LegacyComfortV1 with its exact constants and tests.
- Create distinct schemas for SafetyAssessment, ConditionsFit, PerformanceLoad, Uncertainty, and Explanation.
- Persist each model/policy version and provider provenance.
- Dual-compute in shadow and compare rankings for at least the preregistered seasonal/climate coverage period.
- Release safety UI first if it can stand independently; do not wait for preference personalization.
- Gate calculation, recommendation use, numeric UI, and personalization separately.
- Keep server-side rollback to legacy ranking, but never roll back a stricter safety policy merely to restore engagement.
- Migrate snapshots/API/mobile/web/notifications together; old clients must not interpret a new field using legacy semantics.
- Bump ENGINE_VERSION for any ranking change and maintain an independent safety-policy version for emergency updates.
- Deprecate penalty-point UI only after explanatory replacement ships.
- Publish a plain-language model note, limitations, and substantive changes.

## Open decisions

1. What exact outcome should “comfort” predict, and should the term survive?
2. Should the public surface show no number, an ordered label, a calibrated probability, or a probability range?
3. Which intended-effort input creates enough value without onboarding burden?
4. Which authoritative heat product/method has global coverage suitable for Runcast?
5. Which hazard tiers are hard exclusions versus prominent cautions, and who approves them?
6. What minimum benefit and probability justify changing the recommended start?
7. Which personal preferences may adapt automatically, and after how many labels?
8. What data and evidence are required before supporting minors?
9. Should performance-load estimates be a separate opt-in feature?
10. How are official alerts sourced globally, deduplicated, cached, and localized?
11. Which fairness strata can be evaluated ethically with adequate consent and sample size?
12. Is long-run thermal state modeling worth its complexity over WBGT plus duration/effort policies?

## Evidence boundary and sources

The evidence below shows why the current assumptions are incomplete. It does not validate proposed coefficients or guarantee individual safety.

- Open-Meteo defines apparent temperature as combining wind chill, humidity, and solar radiation: [Weather Forecast API documentation](https://open-meteo.com/en/docs).
- NWS explains heat index as guidance mainly for light activity in shade and notes the direct-sun adjustment: [Heat guidance](https://www.weather.gov/ctp/heat).
- NWS describes WBGT as direct-sun heat stress incorporating temperature, humidity, wind, sun angle, and cloud cover: [WBGT explanation](https://www.weather.gov/btv/heat).
- International consensus states that WBGT is environmental stress rather than individual strain and emphasizes acclimatization, hydration, scheduling, and context: [Consensus Recommendations on Training and Competing in the Heat](https://pmc.ncbi.nlm.nih.gov/articles/PMC4473280/).
- NATA describes exertional heat illness as a combination of metabolic heat, environmental load, impaired dissipation, and individual/extrinsic risk factors: [Exertional Heat Illnesses](https://pmc.ncbi.nlm.nih.gov/articles/PMC4639891/).
- CDC/NIOSH describes gradual 7–14 day acclimatization and differing adaptation needs: [Workplace Recommendations](https://www.cdc.gov/niosh/heat-stress/recommendations/).
- NATA describes cold injury as depending on cold, wetness, wind, clothing, exposure time, and individual response, and calls out movement-generated airflow: [Environmental Cold Injuries](https://pmc.ncbi.nlm.nih.gov/articles/PMC2582557/).
- NWS explains precipitation probability at a forecast point, countering the “percent of route/time” misconception: [What Does Probability of Precipitation Mean?](https://www.weather.gov/lmk/pops).
- UTCI is a multi-node thermophysiological thermal-environment model, useful as a benchmark but not a hard-running model: [UTCI weather-app/model overview](https://journals.ametsoc.org/view/journals/bams/98/12/bams-d-16-0082.1.xml).
- Marathon evidence shows weather/performance associations and ability-dependent optimum ranges rather than one universal value: [Impact of Environmental Parameters on Marathon Running Performance](https://pmc.ncbi.nlm.nih.gov/articles/PMC3359364/) and [Effects of Weather Parameters on Endurance Running Performance](https://pmc.ncbi.nlm.nih.gov/articles/PMC8677617/).
- Open-Meteo documents current ensemble mean/spread access and retention limitations: [Ensemble Mean API](https://open-meteo.com/en/docs/ensemble-mean-api).

## Definition of done

Comfort improvement is done only when Runcast can state what it predicts, separates hazards from preferences, eliminates environmental double-counting, represents workload and interactions, integrates exposure through time, quantifies uncertainty, validates against real runner outcomes, protects sensitive data, and communicates limitations at the recommendation surface.

Changing 11°C to another ideal, fitting four new weights, or adding humidity as a fifth subtraction would preserve the core invalidity and is not completion.
