# Algorithm 1: Route geometry and timing improvement plan

Status: planning proposal; no production behavior is changed by this document.

Owners: Core engine, route ingestion, API persistence, mobile/web map consumers

Primary code: `packages/core/src/engine/geo.ts`, `gpx.ts`, `interpolate.ts`, `types.ts`

Primary tests: `geo.test.ts`, `gpx.test.ts`, `interpolate.test.ts`

Reviewed implementation baseline: `b8600e3` (`Implement Strava-first
authentication`, 2026-07-18)

Current delivery boundary: only the Algorithm 1 row in the
[program implementation commitment](README.md#current-implementation-commitment)
is active. The remaining phases and targets in this document are evidence-gated
design/research options, not current implementation scope.

## Executive verdict

The current geometry pipeline is commendably small, deterministic, dependency-free, and fast enough for ordinary clean GPX routes. It is not yet trustworthy as the geometric foundation for timing. The greatest risks are not the spherical Earth approximation. They are silent data corruption at import and a sampling design whose accuracy falls as routes get longer.

Three issues should block claims of precise route timing:

1. A missing `<ele>` becomes `0`, so one missing value amid valid elevations creates a fictitious descent to sea level and climb back. That can dominate grade-adjusted duration.
2. All tracks and track segments are flattened into one polyline. GPX defines a new `<trkseg>` for discontinuous spans such as lost reception; joining those spans invents distance, direction, elevation change, weather locations, and travel time.
3. The nominal 50 m mesh is silently stretched by the 500-sample cap. It is about 200 m on a 100 km route, while the grade smoothing window simultaneously grows from about 150 m to about 600 m. The same route therefore changes mathematical meaning with route length.

The recommended direction is a versioned, quality-aware canonical route model, spec-aware parsing, explicit handling of discontinuities and missing elevation, and separate geometry/integration/presentation meshes. Ellipsoidal geodesics are a worthwhile correctness improvement, but they rank below ingestion correctness, elevation provenance, and resolution convergence.

## What exists today

The present pipeline is:

`GPX string -> regex scans -> RoutePoint[] -> spherical segment lengths -> cumulative[] -> evenly spaced skeleton -> downstream weather/sun/wind/comfort`

| Stage                | Current behavior                                                                                                                                 | Complexity                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| GPX recognition      | Case-insensitive search for a `<gpx` root, then case-sensitive regular-expression scans for all `trkpt`; fallback to all `rtept`, then all `wpt` | O(B) per scan for B input bytes; up to three scans |
| Point decoding       | Parse finite `lat`/`lon`; parse a narrowly formatted `<ele>`; otherwise set elevation to `0`                                                     | O(P) storage for P points                          |
| Route distance       | Sum haversine distances on a sphere with mean radius 6,371,008.8 m                                                                               | O(P) time and O(P) cumulative-distance storage     |
| Lookup               | Binary-search `cumulative`, linearly interpolate latitude, longitude, and elevation, and use the segment's initial great-circle bearing          | O(log P) per lookup                                |
| Skeleton             | Choose `n = min(max(round(total / 50), 1), 499)` and emit `n + 1` evenly spaced points                                                           | O(M log P), M <= 500                               |
| Flat timing helpers  | Closed form `time = start + distance / speed`; inverse is clamped to route extent                                                                | O(1)                                               |
| Grade-aware playback | Binary-search the skeleton by arrival time and linearly interpolate distance                                                                     | O(log M) per animation lookup                      |

The public `Route` type stores only points, cumulative distances, and total distance. It cannot distinguish missing elevation from true zero, separate continuous parts, record import repairs, state the distance algorithm, or expose confidence.

### Effect of the Strava-first implementation

Commit `b8600e3` makes Strava a primary identity and route-acquisition path, but
does not change the geometry algorithm. A Strava route is still explicitly
selected, exported as a complete GPX string, parsed by the same V1 regex
scanner, checked against the 20,000-point limit only after parsing, and then
persisted as `source: 'strava'` under the provider-neutral Runcast user UUID.
Signing in or linking Strava does not automatically import routes, which is the
correct consent boundary.

This increases the operational priority of ingestion hardening:

- the provider response is accumulated with `response.text()` without a proven
  streamed byte limit, so the API point cap is not a pre-allocation or
  pre-parse resource bound;
- Strava exports receive the same missing-elevation, segment-flattening, and GPX
  subset behavior as local uploads;
- persisted `providerId` supports import identity, but the canonical V1 object
  cannot be faithfully reprocessed unless the provider export remains
  available or a consented source artifact is retained;
- disconnecting an identity/provider must not silently change an already
  imported route's geometry or ownership; reprocessing availability becomes an
  explicit route-quality/source state;
- route ownership and caches must use the neutral Runcast UUID, never a Strava
  athlete ID or Apple subject.

No change is required to the recommended geometry model. The commit makes the
provider-ingestion tests and source-retention decision launch-critical rather
than optional hardening.

## Strengths worth preserving

- Unit conventions are explicit and coherent: meters, m/s, and UTC epoch milliseconds.
- Pure functions make the engine portable across Node, browsers, and React Native/Hermes and make deterministic tests easy.
- Haversine is numerically good at short running-route segments, and the mean-radius sphere is usually below the error of consumer GPS. Replacing it is not an emergency.
- Cumulative distance plus binary search is a simple and correct random-access structure for a valid monotone polyline.
- The skeleton includes exact start and finish and has equal distance intervals, which makes distance-weighted summaries straightforward.
- Lookup costs are bounded, and the cap protects interactive clients from obviously unbounded downstream work.

These strengths argue for evolving the data contracts and separating concerns, not replacing the engine with an opaque GIS stack.

## Critical findings

Severity meanings: **critical** can invalidate the entire route or recommendation; **high** materially changes timing or conditions for realistic inputs; **medium** creates bounded error or operational fragility; **low** is cleanup or future-proofing.

| Severity | Finding                                                           | Concrete failure mode                                                                                                                                                                                                                        | Required response                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Missing elevation is encoded as sea level                         | Points `180 m, missing, 181 m` become `180, 0, 181`; smoothing still creates enormous false grades, then clamps them and delays the route                                                                                                    | Make elevation nullable/quality-tagged. Never impute `0` for absence. Disable grade adjustment or enrich from a trusted source when coverage is insufficient.                                                                          |
| Critical | Track/segment boundaries are discarded                            | Two spans on opposite sides of a GPS outage, or two tracks in one file, are connected by a straight segment. The official GPX schema says segments are distinct continuous spans                                                             | Preserve tracks and segments; require an explicit selection/merge policy. Never bridge a segment boundary implicitly.                                                                                                                  |
| High     | Coordinates are insufficiently validated                          | Latitude `999`, longitude outside range, repeated points, an isolated GPS jump, `Infinity`-like strings, or a zero-length route can enter derived geometry or be silently skipped and bridged                                                | Validate bounds and finite values, reject or quarantine outliers, collapse duplicates deliberately, enforce a positive usable route length, and return structured diagnostics.                                                         |
| High     | Fixed sample count couples route length to accuracy               | A 100 km ultra gets ~200 m intervals and ~600 m elevation smoothing; a 5 km run gets ~50 m/~150 m. Sharp turns, short hills, canopy, and localized weather exposure disappear on longer routes                                               | Use error-bounded/adaptive sampling and independent budgets for integration and rendering. Never silently relax a physical-resolution contract.                                                                                        |
| High     | Latitude/longitude interpolation is not globally safe             | A segment from `179.999°` to `-179.999°` interpolates through `0°`, placing the midpoint on the other side of Earth. Sparse long segments also do not follow the same curve used for distance and bearing                                    | Use WGS84 geodesic interpolation, or at minimum unwrap longitude and use a local tangent-plane interpolation under a proven maximum segment length.                                                                                    |
| High     | Elevation, geometry, and timing have no provenance or uncertainty | A UI receives precise millisecond arrivals even if half the elevations were absent, interpolated, or noisy; persisted legacy routes cannot reveal why                                                                                        | Add route-quality metadata and timing confidence/reason codes. Persist model and canonicalization versions.                                                                                                                            |
| Medium   | A regex scanner is only a GPX subset, despite accepting broadly   | Prefixed elements such as `<gpx:trkpt>`, numeric entities, comments/CDATA, multiple names, namespace variations, malformed nesting, and legal whitespace variants can be misread or ignored. Invalid points are skipped rather than reported | Adopt a small namespace-aware streaming XML parser with DTD declarations and external/general entity resolution disabled while supporting predefined/numeric references, or explicitly document and enforce a strict supported subset. |
| Medium   | Bearing is the bearing of the raw containing segment              | A long sparse segment supplies one initial bearing at every sample; duplicate points return arbitrary north. At vertices the bearing jumps and may misclassify wind                                                                          | Derive a local travel tangent over a bounded along-route window, with one-sided handling at endpoints and explicit undefined behavior for stationary geometry.                                                                         |
| Medium   | Geometry math is not defensive at public boundaries               | `cumulativeDistances([])`, malformed cumulative arrays, empty playback samples, non-positive speed, `NaN`, and zero-distance routes are not guarded in core functions                                                                        | Validate invariants at a single construction boundary and fail with typed errors; keep inner loops lean by accepting only branded/canonical routes.                                                                                    |
| Medium   | The sphere creates a deterministic, avoidable model-form bias     | Error is usually small, varies with latitude and heading, and can reach tens of meters over a long route; it changes persisted distances, split boundaries, anchor placement, and pace displays                                              | Use a tested WGS84 ellipsoidal inverse for canonical distance when the route schema is next versioned; treat this as a migration, not an invisible patch.                                                                              |
| Low      | Repeated binary searches leave performance on the table           | Skeleton distances are monotone, yet each lookup starts a new O(log P) search                                                                                                                                                                | Build monotone samples with a two-pointer O(P + M) sweep. Retain binary search for random UI queries. Optimize only after correctness work.                                                                                            |

## Standards and evidence

The [official GPX 1.1 schema](https://www.topografix.com/gpx/1/1/) establishes several facts the current parser loses: coordinates use WGS84 and measurements are metric; elevation is optional; a track can contain multiple segments; and a new segment represents a distinct continuous span after reception loss or receiver shutdown. The last point means flattening segments is semantically wrong, not merely a parser limitation.

For canonical WGS84 distance, Karney's [Algorithms for geodesics](https://doi.org/10.1007/s00190-012-0578-z) provides accurate, robust inverse and direct solutions on an ellipsoid, including cases where older iterative approaches can fail. A mature implementation or a small validated port is preferable to implementing the paper ad hoc.

A replacement XML parser must not trade regex limitations for entity-expansion or external-resource vulnerabilities. Follow the [W3C XML Namespaces recommendation](https://www.w3.org/TR/xml-names/) for namespace handling and the [OWASP XXE prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html): reject DTD declarations and external/general entity resolution while still supporting predefined and numeric character references. The authenticated GPX request contract has a 2 MB limit, but direct mobile/web parsing and provider/Strava ingestion do not share one proven pre-parse byte boundary. Enforce byte, point, token, and depth limits in every ingestion path and during streaming rather than only after parsing.

## Recommended target architecture

### 1. Separate parsed input from canonical route geometry

Introduce explicit intermediate types rather than constructing `Route` directly:

```text
ParsedGpx
  tracks[]
    segments[]
      points[] { lat, lon, elevation?: { value, source, datum?, accuracy? }, time?, quality? }

CanonicalGpxV2
  parts[]                         // continuous polylines; no implicit bridge
  distanceModel: "wgs84-karney"
  elevationStatus: complete | partial | absent | suspect | enriched
  canonicalizationVersion
  diagnostics[]                  // repairs, dropped points, unresolved decisions
  derivedGeometryProfile         // immutable cumulative distances and tangents

PlannableRouteV2
  selected continuous part, or parts joined by an explicit reviewed connector
  one ordered traversable sequence consumed by timing and planning
```

Keep `RoutePoint.ele: number` only as a V1 compatibility adapter. In V2, absence must be represented as absence. Do not use `NaN` as a sentinel because it spreads silently through arithmetic and JSON cannot preserve it. The canonical GPX container may preserve disconnected source topology, but the engine must accept only a `PlannableRouteV2` with one explicit traversable order; disconnected parts cannot leak into timing as an implicit bridge.

### 2. Make import policy explicit

The parser should return structure and diagnostics; a canonicalizer should decide policy:

- One track/one segment: accept after validation.
- One track/multiple segments: preserve separate parts. If the product requires one continuous runnable route, ask the caller to choose a segment or explicitly connect them only when endpoints satisfy a configured distance and elevation-confidence rule.
- Multiple tracks/routes: expose selection or reject as ambiguous. Do not concatenate by document order.
- Waypoints alone: reject as a route by default; unordered points of interest are not necessarily a runnable polyline. Supporting them should be an explicit legacy mode.
- Bad individual points: report count and reason. Only drop a point when its neighbors remain plausibly connected; otherwise split the part or reject.
- Implausible jumps: detect with both segment length and, when timestamps exist, implied speed. Thresholds must be product-configurable and evaluated against a fixture corpus, not hard-coded from intuition.

### 3. Build a quality-aware elevation profile

Elevation handling should precede any timing model:

- Preserve source elevation when present, along with its provenance.
- Treat partial absence as gaps. Interpolate only short gaps bounded by reliable values and record the operation.
- For absent or suspect profiles, optionally enrich from a consistent DEM/elevation service and record provider, resolution, vertical datum, fetch time, and license. This is a separate I/O step, not hidden in the pure engine.
- Detect isolated spikes with robust local statistics in physical distance, not point index. Flag rather than blindly flatten large real features.
- Emit an elevation confidence profile. Grade-adjusted timing must have an explicit fallback when confidence is low: flat timing plus a visible “elevation unavailable” status is safer than false precision.

### 4. Use one coherent geodesic model

Create a `Geodesic` adapter used for distance, interpolation, and tangent/bearing. Preferred canonical behavior is WGS84 ellipsoidal inverse/direct interpolation based on a vetted implementation of Karney's algorithm. This removes model inconsistency and handles the antimeridian.

An acceptable lower-dependency alternative is:

1. validate that every normalized segment is shorter than a conservative threshold;
2. unwrap longitude;
3. project each local chunk to an east/north tangent plane;
4. interpolate and measure within that chunk;
5. test errors against an ellipsoidal oracle.

The alternative may be faster and smaller, but it creates chunk-boundary and polar behavior to maintain. Benchmark first. Do not choose ellipsoidal geodesics on the claim that the present distance error is the dominant user problem; choose them to make V2 behavior coherent and globally defined.

### 5. Separate meshes by responsibility

One `SkeletonPoint[]` currently serves geometry, grade integration, weather/sun sampling, summaries, map rendering, and playback. Those responsibilities need different resolutions.

- **Geometry profile:** preserves route shape and canonical cumulative distance.
- **Timing integration mesh:** contains every material elevation/grade break and is refined until estimated duration converges within a tolerance.
- **Environmental evaluation mesh:** resolves turns and exposure/weather gradients with a maximum spatial gap, subject to explicit performance budgets.
- **Presentation mesh:** simplified for map rendering and capped by device capability without changing engine results.

If adaptive intervals replace equal spacing, every aggregate must become interval-weighted. `summarize` cannot continue averaging sample values equally; each interval must carry `startDistance`, `endDistance`, or an integration weight. Bands and split generation must also use exact boundaries rather than inferred sample count.

A practical first version can remain distance-based: start at 50 m, insert raw vertices where heading change exceeds a measured threshold, insert elevation-profile breakpoints, and refine intervals whose midpoint changes duration or environmental classification beyond tolerance. Enforce a maximum gap and expose a `resolutionLimited` diagnostic instead of stretching silently.

### 6. Establish a validated route boundary

Construct a canonical/branded route only after checking:

- at least one continuous part with at least two distinct valid points;
- finite coordinates in latitude `[-90, 90]` and normalized longitude range;
- finite, non-negative, monotone cumulative distance;
- total distance above a documented minimum and below supported product limits;
- no unresolved discontinuity;
- elevation status and provenance;
- finite positive speed before timing;
- non-empty, strictly increasing arrival times before inversion/playback.

Core internals can then rely on these invariants. Public helpers should return typed failures rather than arrays containing `NaN`, `Infinity`, duplicate zero-time points, or arbitrary bearings.

## Alternatives and trade-offs

| Decision         | Recommended default                                                                                                   | Alternative                                                    | Trade-off                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GPX parsing      | Namespace-aware streaming parser; reject DTD/external/general entities while supporting predefined/numeric references | Tighten the current scanner into an explicitly limited grammar | A parser dependency adds bundle and compatibility work; maintaining an XML grammar in regex accumulates correctness debt                  |
| Segment handling | Preserve parts and require explicit route selection/connection                                                        | Automatically choose the longest continuous segment            | Auto-selection is convenient but can discard a warm-up, loop, or intended second part without consent                                     |
| Distance         | WGS84 ellipsoidal geodesic in V2                                                                                      | Keep haversine with defensive clamping                         | Haversine is smaller and adequate locally; ellipsoidal behavior is coherent, global, and easier to validate against authoritative vectors |
| Elevation gaps   | Quality-aware gap handling and optional enrichment                                                                    | Disable grade adjustment for any incomplete profile            | Enrichment improves coverage but adds latency, licensing, datum, cache, and outage concerns; disabling is honest but less useful          |
| Sampling         | Error-bounded adaptive engine mesh plus capped presentation mesh                                                      | Raise `MAX_SAMPLES` and retain fixed 50 m                      | Raising the cap is a useful interim fix, not convergence: it still misses turns/short features and scales work with distance              |
| Lookup           | Monotone sweep during mesh construction; binary search for random access                                              | Binary search everywhere                                       | The sweep reduces CPU but should follow profiling; both are simple once invariants are sound                                              |

## Data and threshold calibration

Geometry formulas do not require statistical fitting, but normalization and sampling thresholds do.

Build a versioned, license-compatible GPX conformance corpus containing exports from Strava, Garmin, Apple/Health-compatible tools, route planners, handheld GPS devices, and synthetic spec fixtures. Label expected tracks, segments, discontinuities, missing elevations, names, and errors. Include low-quality real traces only with consent and strip identifiers.

For each proposed outlier, simplification, heading, and refinement threshold:

1. compare the canonical route against a manually reviewed map and elevation profile;
2. measure distance, ascent, timing, weather-anchor locations, headwind classification, and downstream recommendation deltas;
3. stratify by route length, point density, terrain, latitude, urban canyon/tree cover, source provider, and antimeridian/polar synthetic cases;
4. choose thresholds from explicit false-drop and false-accept costs;
5. freeze threshold/version metadata so a route can be reproduced.

Do not use the current parser output as ground truth. For geodesic calculations, use published GeographicLib/Karney test vectors or a pinned authoritative implementation as the oracle. For elevation, use surveyed or high-quality barometric/DEM references where available and retain their uncertainty.

## Staged implementation plan

### Phase 0 — characterize and contain

- Add fixture-only diagnostics around the current parser: segment count, missing-elevation count, invalid-point count, duplicate count, maximum raw segment, nominal skeleton gap, and grade extrema.
- Build the GPX conformance/adversarial corpus and capture current V1 outputs as snapshots, labeling known-bad results rather than treating every snapshot as desired behavior.
- Exercise local GPX, authenticated GPX, and Strava-export ingestion through
  the same byte, token, point, timeout, cancellation, and diagnostic corpus.
  Enforce a streamed response-size limit before accumulating or parsing a
  provider export.
- Add core boundary guards for empty/non-finite inputs in the future implementation design; avoid changing persisted distance semantics in an unversioned patch.
- Decide product behavior for multiple tracks, discontinuous segments, all-missing elevation, and partial elevation.

### Phase 1 — parsing and canonical route V2

- Implement the structured, namespace-aware parser, `CanonicalGpxV2`, and explicit `PlannableRouteV2` selection/connection boundary behind a feature flag.
- Preserve source bytes or a privacy-reviewed reprocessing artifact if future re-canonicalization is a requirement; current canonical V1 JSON cannot recover lost segment/elevation-absence information.
- Validate coordinates and return structured import diagnostics with user-actionable messages.
- Continue adapting V2 to the V1 engine in shadow mode to isolate parser deltas first.

### Phase 2 — geometry profile and elevation quality

- Introduce the coherent geodesic adapter and canonical distance/interpolation/tangent profile.
- Implement nullable elevation, provenance, conservative gap repair, and low-confidence flat-timing fallback.
- Recompute coordinate hashes, coverage masks, weather anchors/caches, split markers, reverse transforms, and closed-loop/out-and-back features from V2 geometry.
- Version persisted canonical routes and the engine. Never mutate V1 distance in place.

### Phase 3 — decoupled adaptive meshes

- Add interval weights and separate timing/environment/presentation meshes.
- Establish a high-resolution reference evaluator, then tune adaptive refinement to a duration and condition-classification error budget.
- Remove the silent `MAX_SAMPLES` resolution stretch from engine semantics. Keep a separate rendering cap.
- Change monotone mesh construction to an O(P + M) sweep if profiling supports it.

### Phase 4 — migration and default-on rollout

- Shadow-compute V1/V2 for consented or synthetic routes and inspect deltas by quality category.
- Reprocess routes only when the original GPX/provider export remains available. Otherwise label them legacy; do not infer whether stored zero elevations meant missing or actual sea level.
- Ask users to re-import ambiguous legacy routes. Preserve the V1 artifact until V2 is accepted.
- Gradually enable V2 ingestion, then V2 planning, with rollback by route/model version.

## Verification strategy

### Unit and property tests

- Distance is non-negative, symmetric, finite, and zero only for coincident valid positions within numeric tolerance.
- Cumulative distances start at zero, are finite and monotone, and reverse-route total distance is invariant.
- Direct/inverse interpolation round-trips distance within the error budget.
- Position is continuous across ordinary vertices and remains near `±180°` at an antimeridian crossing.
- Tangents are stable under insertion/removal of collinear points and are undefined, not arbitrary north, for stationary geometry.
- Increasing mesh resolution converges rather than materially changing total duration or summaries.
- Parsing then serializing a supported GPX structure preserves track/segment/point topology.

Use generative tests over valid coordinate pairs, monotone polylines, duplicate runs, longitude wrap, near-pole routes, random segment partitions, and finite/non-finite corruptions.

### Adversarial import tests

- Multiple tracks; multiple segments; empty segments; track plus route plus waypoints.
- Missing, partial, zero, negative, scientific-notation, namespaced, and extension-provided elevation.
- Valid sea-level routes, so “all zeros means missing” is never introduced as a heuristic.
- Out-of-range coordinates, malformed attributes, comments, CDATA, entity encodings, prefixed namespaces, huge numeric tokens, deeply nested extensions, DTD/entity declarations, and files at byte/point limits.
- Duplicate points at start, middle, and end; single massive jumps; GPS gaps with timestamps; loops and self-crossings.
- Zero-distance and sub-minimum routes, 20,000-point routes, 100 km routes, and high-turn-density urban routes.

### Golden tests

- Pin ellipsoidal distance, azimuth, direct-position, antimeridian, polar, and nearly antipodal vectors from the chosen authoritative oracle.
- Maintain reviewed GPX goldens with expected canonical parts, diagnostics, distance, and elevation status.
- Record downstream golden deltas for weather-anchor coordinates, canopy-mask indices, wind bearings, splits, reversal, and recommendation results.
- Golden files must include provenance, oracle/version, tolerance, and why the result is correct.

### Field validation

- Select routes with surveyed race distances or high-quality mapping, representative point densities, hills, switchbacks, outages, and sea-level sections.
- Compare route distance and landmark positions against a trusted GIS/geodesic tool; compare elevations against barometric or surveyed references where possible.
- Replay actual activities only as observational validation, not unquestioned truth: consumer GPS itself contains noise and map mismatch.
- Have reviewers inspect every high-severity V1/V2 delta before default-on.

### Performance tests

- Benchmark parsing at 2 MB/20,000 points on API Node and representative low-end Hermes hardware.
- Benchmark canonicalization, random `positionAt`, monotone mesh construction, plan recomputation, map render simplification, and playback inversion.
- Assert memory ceilings and main-thread time. Performance protections must report a degraded-resolution status rather than alter the physical model silently.

## Telemetry and observability

Collect privacy-preserving, versioned counters and distributions, not raw route coordinates:

- parser/canonicalizer version, source class, byte and point-count buckets;
- track/segment counts; missing/partial/suspect elevation ratios; invalid/dropped/duplicate point counts;
- maximum segment bucket, total-distance bucket, nominal and maximum mesh gaps, adaptive point count, refinement-limit hits;
- import result/error code and user re-import/abandon outcome;
- V1/V2 differences in distance, duration, ascent, anchor position, and recommendation winner, bucketed and sampled;
- parse/canonicalize/plan latency and memory by runtime;
- timing confidence and low-confidence fallback rate.

Coordinate hashes are identifiers and should still be treated as sensitive/pseudonymous data. Define retention and access controls, and do not log route names, XML fragments, exact endpoints, or detailed diagnostic coordinates.

Alert on spikes in import rejection, missing-elevation fallbacks, V1/V2 distance deltas, adaptive-limit hits, and non-finite engine results.

## Rollout, migration, and compatibility

This is a data migration, not only an algorithm swap.

- Add `routeSchemaVersion`, `canonicalizationVersion`, `distanceModel`, `elevationStatus`, and `timingModelVersion` to persisted artifacts and snapshots.
- A V2 distance change invalidates dependent weather anchors, coverage masks, splits, reverse-distance transforms, route distance displays, cached forecasts, coordinate hashes, and potentially watch recommendations. Rebuild them atomically or mark them stale.
- Keep V1 planning available by artifact version during rollout. Never evaluate V1 cumulative arrays with V2 interpolation semantics.
- Legacy routes without original source cannot be faithfully upgraded. Offer re-import; otherwise retain V1 with a visible legacy/low-confidence status.
- Dual-run in shadow mode, canary by account/device/runtime, and stop rollout automatically on acceptance-guard regressions.
- Bump `ENGINE_VERSION` whenever recommendation semantics change, and include route/model versions in idempotency/cache keys.

## Acceptance criteria

V2 should not become the default until all of the following are demonstrated:

### Correctness

- 100% of supported GPX conformance fixtures preserve expected track/segment topology; unsupported ambiguity produces a structured error or selection requirement.
- No absent elevation is represented as numeric zero. Partial profiles cannot reach grade timing without an explicit, recorded repair or fallback.
- Invalid/out-of-range coordinates and non-positive usable route lengths never produce a `Route` or plan.
- Ellipsoidal distance/interpolation/azimuth pass the chosen authoritative golden suite within its documented implementation tolerance; antimeridian and polar fixtures remain finite and geographically correct.
- Route reversal preserves total distance within 1 cm or the selected oracle tolerance, whichever is larger.
- All public timing/position outputs are finite, monotone where required, and deterministic for a pinned version.

### Resolution and downstream stability

- Against a 10 m or finer reference evaluation, adaptive-mesh total duration differs by <= 0.5%. Define a material transition per field before implementation (for example, a category boundary or scalar change large enough to alter a summary/policy threshold); those declared transitions must be localized within 25 m on the validation corpus.
- Doubling the maximum mesh resolution changes duration by <= 0.25% and summary comfort by <= 0.005 for 99% of the corpus; exceptions are reported and reviewed.
- Crossing the legacy 500-point threshold introduces no discontinuity beyond the declared convergence tolerance; changes arise only from bounded resolution error reported by the adaptive evaluator.

### Product and performance

- P95 parse plus canonicalization stays below 100 ms on the supported API tier for a 2 MB/20,000-point file, with a separately established low-end mobile budget for local imports.
- Local, authenticated-upload, and Strava-provider inputs enforce equivalent
  byte/point/token/depth limits before unbounded allocation; provider timeout
  or oversize failures return a typed import result and persist no partial
  route.
- P95 interactive plan recomputation meets the current product frame/interaction budget on representative mobile and web devices; the exact budget must be recorded before implementation.
- Import success does not regress for clean currently supported single-track/single-segment fixtures; all newly rejected cases have actionable messages.
- Shadow rollout shows no unexplained >1% distance delta or >2% duration delta; explained changes are categorized and approved.
- Telemetry contains no raw coordinates, route names, GPX fragments, or exact endpoints, verified by a logging/privacy test.

## Risks and open decisions

1. **What is a “route” when GPX contains multiple continuous parts?** The product needs a selection/merge UX decision before V2 schema work stabilizes.
2. **Can original imports be retained for reprocessing?** This affects privacy, storage, user consent, and whether future canonicalization is possible.
3. **Which elevation source and vertical datum are acceptable?** Mixing GPS, barometric, orthometric, and ellipsoidal heights without metadata can create systematic steps.
4. **Should waypoints ever form a route?** The current fallback is convenient but not semantically guaranteed by GPX.
5. **What route lengths and point densities are officially supported?** Engine, API, mobile, map, forecast, and coverage budgets need one contract.
6. **Which geodesic implementation satisfies bundle, license, Hermes, and audit constraints?** Benchmark vetted candidates; do not implement from memory.
7. **How should low-confidence timing be shown?** A range/status is more honest, but product language must remain useful rather than alarming.
8. **Can adaptive sampling change downstream weighting now?** It requires coordinated changes to summaries, bands, splits, playback, weather, and tests.
9. **How much V1 compatibility is required?** Exact persisted outputs and improved correctness cannot both be guaranteed; versioning must make that trade-off explicit.

## Recommended decision

Approve Phase 0 and the V2 canonical-route design before tuning any constants in `geo.ts` or raising `MAX_SAMPLES`. The first shipped user-facing improvement should be honest elevation/segment handling with confidence-aware flat fallback. Follow with coherent geodesics and decoupled adaptive meshes. This sequence removes catastrophic errors first, makes later grade work measurable, and prevents an apparently more sophisticated pace model from amplifying corrupt geometry.
