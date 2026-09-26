# Algorithm 4: Solar exposure and canopy improvement plan

Status: proposed
Scope: `packages/core/src/engine/solar.ts`, `exposure.ts`, `plan.ts`, `types.ts`; `packages/core/src/io/overpass.ts`; route coverage persistence/fetching; weather radiation inputs
Planning only: this document specifies investigation and staged work, not a production-code patch.

Current delivery boundary: only the Algorithm 4 row in the
[program implementation commitment](README.md#current-implementation-commitment)
is active. The remaining phases and targets in this document are evidence-gated
design/research options, not current implementation scope.

## Executive judgment

Runcast’s astronomical sun position is likely accurate enough for a running app through ordinary dates and latitudes. The exposure result is not. The current four-state model—sun, shade, covered, night—combines a precise ephemeris with two coarse thresholds and a static 50 m “forest polygon” mask. That precision mismatch creates confidence without corresponding physical support.

The most serious findings are:

- the code returns **refraction-corrected apparent elevation** and then uses the conventional −0.833° sunrise threshold, which already represents refraction plus the solar disc when applied to geometric solar-center elevation; this likely double-counts refraction around sunrise/sunset;
- 85% total cloud cover is treated as binary shade even though cloud fraction is not direct-beam irradiance; Open-Meteo already offers direct normal irradiance and diffuse/shortwave radiation;
- all sun below 8° elevation becomes “shade,” although low sun can be intense and is only occluded if local terrain, trees, or buildings block its azimuth;
- being inside an OSM woodland polygon is equated with being covered, regardless of canopy density, crown height, trail clearing, leaf season, storm loss, or sun direction;
- relation holes are explicitly ignored, and the parser appears not to assemble Overpass multipolygon relations at all;
- a successful response with no extracted top-level rings is interpreted as open ground, so a relation-only forest or an unparsed response can become confidently open;
- urban street trees, tree rows, buildings, tunnels, arcades, covered ways, topographic horizons, and shadows cast from nearby rather than overhead features are missing;
- the app directly relies on a shared public Overpass instance despite official guidance that a general audience app should not use public instances as its backend.

The recommended target is not “a better canopy mask.” It is a continuous, provenance-rich exposure estimate:

```text
solar geometry
  + forecast direct/diffuse radiation
  + directional occlusion from terrain/buildings/vegetation
  + data freshness/confidence
  -> direct and diffuse exposure estimate
  -> UI categories and comfort effects
```

First correct solar threshold semantics, parse geospatial data honestly, and replace cloud-cover shade with radiation. Then add data fusion and directional occlusion only where benchmarks justify cost. A highly accurate NREL ephemeris does not compensate for a missing building or a ten-year-old canopy map.

## What exists today

### Solar position

`solar.ts` ports equations attributed to NOAA/Meeus:

1. epoch milliseconds to Julian centuries;
2. geometric solar longitude/anomaly and orbital eccentricity;
3. apparent longitude and corrected obliquity;
4. solar declination and equation of time;
5. true solar time and hour angle;
6. zenith/elevation and azimuth;
7. an empirical atmospheric-refraction correction.

`solarPosition` returns refraction-corrected elevation, azimuth clockwise from true north, and declination. `sunWindows` scans every ten minutes and bisects horizon crossings.

`SUNRISE_ELEVATION = -0.833` is described as accounting for refraction and the solar disc. That threshold is applied to the already refraction-corrected elevation in both `exposureOf` and `sunWindows`.

Existing solar tests check solstice/equinox declination, approximate noon geometry, broad Chicago sunrise/sunset behavior, azimuth ordering, refraction vicinity, polar summer, and night-window topology. They do not compare a broad matrix against an independent reference implementation, distinguish geometric/apparent/upper-limb elevation, or directly verify sunrise transition time.

### Exposure classification

`exposureOf` applies these rules in order:

1. apparent elevation ≤ −0.833° → night;
2. coverage = tree → covered;
3. cloud cover ≥85% or elevation <8° → shade;
4. otherwise → sun.

Unknown coverage is treated as open. This is a reasonable “warn about sun” product instinct, but the state does not preserve uncertainty, and downstream summaries treat every non-sun state as shade.

### Coverage extraction

`fetchCoverage`:

- computes the route bounding box with a fixed 0.002° pad;
- queries the public `overpass-api.de` endpoint for ways and relations tagged `natural=wood` or `landuse=forest`;
- expects each returned element to have one top-level geometry ring;
- samples the route every 50 m;
- uses planar longitude/latitude ray casting for point-in-ring;
- returns tree if any ring contains the point, otherwise open;
- returns an all-unknown mask on HTTP/network/parse failure;
- returns all-open if a successful response yields no extracted rings.

No dedicated unit tests target `exposure.ts` or `overpass.ts`; plan/reversal integration tests exercise basic exposure and `coverageAt` behavior, while the Overpass query/parser remains untested. Precomputed demo masks bypass this fetch. Uploaded web/mobile routes show unknown coverage immediately and later replace it asynchronously if Overpass answers. Saved/API routes persist whatever mask was submitted; there is no source/version/fetched-at/confidence metadata in `CoverageMask`.

## Critical failure modes

### Severity summary

This document uses **critical** for a correctness flaw that can make an exposure result wrong route-wide or convert incomplete evidence into confident output; it does not imply Algorithm 7's P0 safety definition. **High** materially misclassifies realistic routes, and **medium** creates bounded resolution or transfer errors.

| Severity | Failure                                                        | Consequence                                                                  | Immediate stance                                                   |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Critical | Sunrise threshold is applied to refraction-corrected elevation | Day/night transitions are physically inconsistent and likely early/late      | Separate geometric/apparent elevation and upper-limb semantics     |
| Critical | Unparsed relation-only woodland can become all-open            | Forest routes can be labeled sunny with high confidence                      | Never infer open from “no parsed rings” without completeness proof |
| Critical | Relation holes and multipolygon structure are ignored          | Lakes, clearings, courtyards, disjoint parts, and split rings are wrong      | Use a standards-capable geometry assembler                         |
| High     | Cloud fraction is used as binary solar attenuation             | Bright overcast, thin cloud, broken cloud, and direct beam are misclassified | Use direct/diffuse radiation variables                             |
| High     | Static inside-forest mask is called canopy/coverage            | It models land-cover membership, not overhead or directional shade           | Rename, preserve provenance, and add canopy evidence               |
| High     | No buildings or terrain                                        | Urban and mountain shade—the cases where azimuth matters—are absent          | Add directional occlusion in stages                                |
| High     | Public Overpass is a production backend                        | Rate limits/load shedding create silent unknown/open behavior                | Server-side cache and sustainable data source                      |
| High     | No source time/confidence                                      | Stale tree removal, new development, sparse mapping are invisible            | Version all occluder evidence and expose quality                   |
| Medium   | Fixed 50 m nearest bucket                                      | Narrow shade/open transitions shift or disappear                             | Use geometry-aware segment integration/adaptive sampling           |
| Medium   | 8° low-sun threshold is globally constant                      | Directional, latitude, terrain, and urban context are collapsed              | Remove as physical rule; retain only as calibrated fallback        |

### 1. The sunrise convention is probably double-counted

NOAA documents an assumed 0.833° refraction correction for sunrise/sunset and separately documents a refraction formula for solar-position elevation. NOAA also warns that observed transitions vary with pressure, humidity, and conditions: <https://gml.noaa.gov/grad/solcalc/calcdetails.html>.

Runcast:

- computes geometric center elevation;
- adds NOAA’s refraction correction;
- compares the apparent center elevation with −0.833°.

The conventional −0.833° geometric-center threshold approximately combines atmospheric refraction near the horizon and the Sun’s angular radius so sunrise is the upper limb appearing. Applying it to an already corrected apparent center counts at least the refraction component twice.

The target API must make definitions impossible to mix:

- `geometricCenterElevation`;
- `apparentCenterElevation`;
- `apparentUpperLimbElevation` if needed;
- `isSolarDiscVisibleOnAstronomicalHorizon`;
- optional local-horizon elevation.

Use one documented transition definition consistently. Validate transition times against an independent solar-position implementation. This is more important than squeezing another arcsecond from the ephemeris.

### 2. Source claims are too strong

The code comment says accuracy is quoted at ±0.01° for 1800–2200. NOAA’s current page says its calculator is no longer maintained or supported, describes sunrise/sunset theoretical accuracy in minutes (within ±72° latitude), and calls the underlying approximations very good for roughly 1800–2100; it does not support the current code comment’s exact claim: <https://gml.noaa.gov/grad/solcalc/calcdetails.html>.

NREL’s Solar Position Algorithm (SPA) is a better independent reference and states ±0.0003° uncertainty over years −2000 to 6000: <https://midcdmz.nrel.gov/spa/> and <https://www.nrel.gov/docs/fy08osti/34302.pdf>.

Options:

- keep the current compact equations, correct documentation, and validate against SPA over Runcast’s supported domain;
- adopt a maintained SPA-equivalent library after bundle/license/platform review;
- implement SPA internally only if maintenance/tests justify the complexity.

Recommendation: keep the current algorithm initially if it passes a broad SPA golden matrix. The dominant product error is occlusion/radiation, not ephemeris.

### 3. Cloud cover is not shade

Total cloud cover is the fraction of sky covered, not the fraction of direct solar irradiance removed at the runner. An 86% threshold creates a discontinuity where 84.9% is full sun and 85% is shade. It cannot distinguish:

- thin cirrus from optically thick low cloud;
- bright overcast with substantial diffuse radiation;
- broken cloud with intermittent direct beam;
- the Sun occupying the uncovered portion of the sky;
- local cloud timing within an hour.

Open-Meteo provides shortwave radiation, direct radiation/direct normal irradiance, diffuse radiation, and—regionally—15-minute values. Its documentation distinguishes these as preceding-interval means: <https://open-meteo.com/en/docs#hourly-weather-variables>.

Use forecast direct normal irradiance (DNI) or direct horizontal radiation to determine direct-sun load, plus diffuse radiation for residual environmental load. Cloud cover can remain a fallback/diagnostic, never the primary binary occlusion signal.

### 4. “Sun below 8° means shade” is physically indefensible as a global rule

At low elevation the Sun may be blocked by buildings, vegetation, or terrain, but it may also shine directly across an open lake, prairie, beach, ridge, or east/west street. Low-angle sun can be visually and thermally significant. The 8° rule predicts generic surroundings that the system does not observe.

If retained during migration, relabel it `assumedLocalOcclusion`, attach low confidence, and calibrate by context. The target model should compare solar elevation to a local horizon profile at the current solar azimuth.

### 5. Woodland polygon membership is not canopy shade

OpenStreetMap’s own documentation describes `natural=wood` and `landuse=forest` as largely synonymous but inconsistently used; the forest page documents multiple conflicting tagging conventions. These tags identify tree-covered/forestry areas, not crown closure over a trail: <https://wiki.openstreetmap.org/wiki/Forest>.

Missing physical variables include:

- crown footprint and canopy closure;
- distance/lateral offset from the route;
- tree/crown height;
- understory/open glades;
- trail/road width and clearing;
- deciduous/evergreen leaf state;
- seasonal phenology by climate;
- recent harvest/fire/storm mortality;
- isolated street trees and tree rows;
- sun azimuth/elevation and shadow displacement.

A runner can be shaded outside a polygon by a nearby crown’s shadow and sunlit inside it through a clearing. Static membership cannot express either.

### 6. Multipolygon handling is not merely approximate; it is structurally incomplete

OSM multipolygons may comprise multiple outer ways, disjoint parts, and inner holes. Tags generally live on the relation; members assemble the geometry. The OSM multipolygon documentation explicitly defines outer and inner roles: <https://wiki.openstreetmap.org/wiki/Multipolygon>.

The current `OverpassElement` type only reads a top-level `geometry`. A relation returned with `out geom` carries member geometry/roles that must be assembled; it is not safe to assume one top-level ring. The Overpass geometry documentation describes this expanded relation structure: <https://dev.overpass-api.de/overpass-doc/en/full_data/osm_types.html>. The code also intentionally ignores holes.

Consequences:

- relation-mapped forests may be ignored;
- a lake/clearing hole becomes tree;
- split outer ways may never become a closed ring;
- disjoint relation parts are mishandled;
- if no top-level rings survive, the response becomes all-open.

Use a mature OSM-to-GeoJSON/multipolygon assembler with recorded fixtures and geometry validation. Invalid/incomplete geometry must degrade to unknown, not open.

### 7. “Successful empty response” is not sufficient proof of open ground

No extracted rings can mean:

- genuinely no queried tags;
- woodland represented by a relation the parser ignored;
- a timeout/partial response with HTTP 200;
- malformed geometry;
- tags outside the two-query vocabulary;
- stale/incomplete OSM coverage;
- bbox/antimeridian error.

Only a response proven complete and successfully parsed may support “no OSM woodland evidence.” Even then, the output should be `noWoodlandEvidence`, not physical `openCanopy`.

### 8. The query vocabulary misses common shade

At minimum, investigate:

- `landcover=trees`;
- `natural=tree`, `natural=tree_row`;
- orchards where relevant;
- `covered=*`, tunnels, arcades/colonnades, building passages;
- building footprints and heights/levels;
- bridges/overhead structures;
- mapped leaf type/cycle.

Adding tags indiscriminately can increase false shade. Each source must map to evidence with distinct semantics, not directly to the same “tree” boolean.

### 9. The geometry and sampling resolution are fragile

The bbox pad is angular:

- longitude metres per degree shrink with latitude;
- it can fail around the antimeridian;
- 0.002° may be insufficient for long low-angle shadows;
- a very large/complex route bbox can make an expensive Overpass query.

The point-in-polygon ray cast treats lon/lat as a plane. That is acceptable for small, non-antimeridian geometries but should be a declared approximation. Sampling every 50 m and nearest-bucket lookup:

- erases narrow tree-lined segments;
- shifts a boundary by up to roughly 25 m;
- does not integrate shade across sample intervals;
- can alias with the independent 50 m route skeleton;
- cannot refine near boundaries.

Use projected/tiled geometry locally, adaptive samples around intersections/boundaries, and segment-length integration for summary fractions.

### 10. Terrain and buildings dominate many real routes

The solar azimuth is calculated and then unused. Without directional occlusion:

- a canyon wall or ridge never delays sunrise;
- buildings never cast morning/evening shadows;
- street-canyon orientation is irrelevant;
- a tree west of the path cannot shade it in the afternoon;
- a tree overhead marks “covered” even if leafless or sparse.

Terrain horizon can be modeled with a DEM and azimuth-sector maximum elevation angles. Building shadows require footprint plus reliable height; OSM height/levels coverage is uneven. Vegetation shadows require crown geometry/height/closure that global datasets only approximate. These should be separate occluder layers with confidence, not one mask.

### 11. Coverage freshness and provenance do not exist

`CoverageMask` stores only resolution and values. A saved mask can survive:

- tree removal;
- leaf season changes;
- new construction;
- OSM edits;
- algorithm/parser changes;
- source dataset updates.

Persist:

- source(s), dataset/license/version/date;
- fetch/build time and coordinate hash;
- algorithm/schema version;
- spatial resolution;
- completeness/parse warnings;
- per-segment confidence;
- seasonal assumptions;
- hard/soft expiry and refresh policy.

### 12. Public Overpass is not a sustainable application backend

The Overpass project explains that public instances share capacity among many users, use rate limits/load shedding, and specifically says that an app for more than OSM mappers should not rely on public instances as its backend; self-hosting or another sustainable source is recommended. It gives broad limits around 10,000 requests/day and 1 GB/day: <https://dev.overpass-api.de/overpass-doc/en/preface/commons.html>.

Direct mobile/web requests also reveal route bounding boxes and produce inconsistent results across clients. Production coverage generation should be server-side, cached by privacy-reduced spatial tiles/coordinate hash, rate-limited, retried, and backed by a sustainable OSM extract/provider arrangement.

## Target model and architecture

### 1. Separate four concepts now conflated

1. **Astronomical geometry**: where the solar center/disc is in a defined geometric/apparent coordinate system.
2. **Atmospheric radiation**: expected direct and diffuse irradiance before local occlusion.
3. **Local occlusion**: terrain/building/vegetation blocks along the solar ray.
4. **Product interpretation**: categories, thermal/visual effect, uncertainty, and runner-facing language.

Each can evolve and be validated independently.

### 2. Target exposure estimate

```text
ExposureEstimate
  time, position
  sun:
    geometricCenterElevation
    apparentCenterElevation
    azimuth
    discState
  radiation:
    directNormal
    directHorizontal
    diffuseHorizontal
    sourceInterval
  occlusion:
    directBeamTransmission [0..1]
    skyViewFactor [0..1 or unknown]
    blockers: terrain/building/vegetation/structure
  result:
    directIrradianceEstimate
    diffuseIrradianceEstimate
    category (derived for UI)
    confidence
    reasons
    provenance
```

Continuous transmission/irradiance should feed comfort. Categories should be derived presentation bands with hysteresis, not the physical model.

### 3. Solar geometry module

- Return geometric and apparent elevations separately.
- Implement solar-disc/upper-limb visibility exactly once.
- Define supported date/latitude domain.
- Accept optional pressure/temperature only if refraction accuracy matters; otherwise state standard-atmosphere assumptions.
- Compare against NREL SPA golden data across the supported domain.
- Handle azimuth undefined at zenith/nadir explicitly rather than assigning a meaningful blocker direction.
- Rework `sunWindows` around a named horizon/disc definition and local horizon where available.

### 4. Radiation module

Fetch and normalize:

- direct normal irradiance;
- direct or shortwave horizontal radiation;
- diffuse radiation;
- interval support/native resolution;
- model/run/uncertainty metadata.

Prefer provider `direct_radiation` when its support matches the calculation. Do not multiply hourly-mean DNI by the cosine of zenith at one instant: if direct horizontal irradiance must be derived from interval-mean DNI, integrate solar geometry over the same support interval, or use genuinely instantaneous/sub-hourly inputs. Preserve interval semantics; Open-Meteo radiation values are preceding-hour means, not instants. Use 15-minute native values only in supported regions and label provider-interpolated sub-hourly values elsewhere: <https://open-meteo.com/en/docs>.

Atmospheric irradiance should already reflect forecast clouds/aerosol approximations. Do not independently apply a binary cloud threshold on top without calibration.

### 5. Occluder evidence store

Represent layers independently:

- **terrain**: azimuth-binned local horizon from DEM;
- **buildings/structures**: polygon, base/roof height, confidence, acquisition date;
- **vegetation**: canopy probability/closure, crown height or range, leaf type/cycle, date;
- **route structures**: tunnel/covered/arcade/indoor evidence;
- **unknown**: missing/incomplete source, never silently open.

Every datum needs source, version/date, resolution, license, and uncertainty.

### 6. Directional ray/visibility evaluation

For each route sample/time:

1. if the solar disc is astronomically below the relevant horizon, direct beam is zero;
2. compare Sun elevation with terrain horizon at Sun azimuth;
3. intersect a finite solar ray/shadow corridor with nearby buildings/structures;
4. estimate vegetation transmission using crown geometry/closure, height, season, and confidence;
5. retain diffuse radiation using sky-view/transmission rather than setting all radiation to zero;
6. combine independent blocker evidence conservatively and report dominant reason.

Full 3D ray tracing at every 50 m/30-minute candidate may be expensive. Precompute route-point horizon/occluder descriptors and evaluate the changing solar vector cheaply. Refine samples only near shadow transitions.

### 7. Data-source strategy

#### OpenStreetMap

Use for semantic vector evidence: forests, trees/tree rows, buildings, heights, tunnels, covered ways. Assemble multipolygons correctly. OSM is ODbL and requires attribution; derived-database obligations need legal review: <https://www.openstreetmap.org/copyright>.

Strength: globally available and semantically rich.
Weakness: heterogeneous completeness, height/vegetation sparsity, volunteer update lag.

#### Global tree-cover raster

ESA WorldCover provides a global 10 m categorical 2021 land-cover product with a tree-cover class, derived from Sentinel-1/2: <https://esa-worldcover.org/en/data-access> (catalog summary: <https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200>).

Strength: consistent global fallback finer than the current 50 m mask.
Weakness: 2021 vintage, categorical land cover rather than crown closure/height, classification error, licensing/attribution and serving costs.

Use as “tree-cover evidence,” not overhead shade truth.

#### Regional canopy products

For the US, the US Forest Service’s 30 m annual Tree Canopy Cover suite includes per-pixel standard error/model uncertainty through 2025: <https://data.fs.usda.gov/geodata/rastergateway/treecanopycover/>.

Strength: annual fraction and uncertainty.
Weakness: 30 m still too coarse for individual street trees/trail clearings; regional only.

#### Elevation/lidar

USGS 3DEP provides free elevation/lidar-derived products in the US, including 1 m products where available: <https://www.usgs.gov/3d-elevation-program>.

Strength: terrain/building/canopy detail regionally.
Weakness: inconsistent acquisition dates/resolutions; global coverage requires another DEM; point-cloud processing/storage cost.

Use a global DEM fallback plus regional higher-resolution products. Distinguish bare-earth DEM from surface model; terrain horizon needs the former, while buildings/canopy may use surface/lidar classifications.

### 8. Coverage/exposure cache service

- Build server-side from route coordinate hash plus occluder dataset versions.
- Tile and reuse source data without storing unnecessary user-route identity.
- Persist descriptors/provenance rather than only binary buckets.
- Deduplicate concurrent builds.
- Apply source-specific refresh intervals (weather radiation hourly; OSM weeks/months; annual raster by release; seasonal phenology daily/modelled).
- Never overwrite high-quality old evidence with a failed/incomplete new fetch.
- Return partial quality per layer.
- Keep client fallback deterministic and visibly degraded.

## Alternatives and trade-offs

### Keep the four states, improve inputs

Pros: limited UI/comfort churn; simple migration.
Cons: binary categories still discard irradiance and confidence.
Recommendation: useful transitional presentation, not target storage/model.

### Replace cloud cover with DNI only

Pros: large immediate atmospheric improvement at low engineering cost.
Cons: still no local shadows; hourly mean can miss cloud intermittency.
Recommendation: highest-value Phase 1 improvement after horizon semantics.

### Correct OSM multipolygons and stop

Pros: fixes a real data-loss bug; preserves global low-cost source.
Cons: woodland is still not canopy/shade; urban shade remains poor.
Recommendation: mandatory baseline, not a finished canopy model.

### Global 10 m tree-cover raster

Pros: consistent fallback; finds unmapped forests.
Cons: dated/categorical; pixels do not yield directional transmission; tile egress/storage.
Recommendation: fuse as one evidence layer with uncertainty.

### Full building/vegetation 3D ray tracing

Pros: physically interpretable transitions; uses solar azimuth.
Cons: missing heights, heavy preprocessing, geometry errors, expensive worldwide datasets.
Recommendation: progressive enhancement in data-rich cities/regions, with explicit fallback elsewhere.

### Computer-vision shade prediction

Pros: imagery can capture crowns/buildings absent from maps.
Cons: image licensing, privacy, seasonal/date mismatch, compute/MLOps, hard-to-audit failures.
Recommendation: research only after a field benchmark and source-license review.

### Crowdsourced shade reports

Pros: route-specific, current, can capture structures/season.
Cons: sparse/noisy labels, time-of-day dependence, location privacy, participation bias.
Recommendation: opt-in calibration/feedback, never sole truth.

### Retain a constant low-sun threshold

Pros: zero data/cost; may mimic average urban obstruction.
Cons: physically wrong in open areas and cannot transfer globally.
Recommendation: temporary low-confidence fallback only, stratified/calibrated and never called measured shade.

## Staged implementation plan

### Phase 0 — Correct semantics and prevent false confidence

- Split geometric/apparent/solar-disc definitions.
- Resolve the −0.833° double-count with golden transition tests.
- Correct source/accuracy comments; state supported date/latitude range.
- Rename static OSM mask semantics from canopy/covered to woodland evidence internally.
- Add source/version/fetched-at/completeness/confidence fields to the coverage schema.
- Change “successful but no parsed rings” from open to unknown until parser completeness is proven.
- Add direct unit tests for `exposureOf`, `coverageAt`, and `fetchCoverage`.

Exit: no unparsed/incomplete data becomes confidently open, and day/night uses one documented convention.

### Phase 1 — Radiation-aware exposure

- Add direct normal/direct/diffuse radiation to the weather field with interval-aware sampling.
- Replace the 85% binary cloud rule with direct-beam and diffuse-load thresholds calibrated from data.
- Remove the 8° physical rule; retain an explicitly assumed fallback behind a flag if product continuity requires it.
- Feed continuous irradiance/transmission into comfort while mapping to legacy categories for UI.
- Add confidence/reason text for missing radiation.

Exit: atmospheric exposure tracks forecast radiation and has no cloud-cover discontinuity.

### Phase 2 — Correct and sustainable geospatial evidence

- Move coverage generation server-side.
- Adopt a tested OSM multipolygon/GeoJSON assembly path preserving holes/disjoint outers.
- Expand semantic tags carefully (trees/tree rows, covered/tunnel/arcade, buildings).
- Replace public Overpass-as-backend with a hosted extract/provider/self-hosted arrangement or strictly cached interim service.
- Use coordinate-hash/source-version cache keys, retries/backoff, and partial-result states.
- Fuse OSM woodland evidence with a global raster fallback; expose disagreements.
- Integrate OSM attribution/license compliance.

Exit: valid relation/hole fixtures render correctly; provider failure/incomplete parsing cannot claim open.

### Phase 3 — Terrain and directional structures

- Precompute terrain horizon profiles at route samples using a declared DEM.
- Evaluate Sun elevation vs horizon azimuth.
- Add covered/tunnel structures as high-confidence blockers.
- Trial building shadows in regions with adequate height coverage.
- Adaptively refine route samples around predicted shadow transitions.
- Retain diffuse radiation under direct occlusion.

Exit: terrain/building mode beats radiation-only baseline on held-out field labels in eligible regions.

### Phase 4 — Canopy transmission and season

- Add fractional canopy/uncertainty datasets.
- Model leaf-on/leaf-off using tagged leaf cycle plus region/phenology fallback.
- Estimate directional canopy transmission using height/closure with conservative uncertainty.
- Add recent-disturbance refresh where data supports it.
- Avoid a global launch until deciduous/evergreen, urban/forest, and hemispheric strata pass.

Exit: canopy model produces calibrated transmission/visibility, not merely a tree boolean.

### Phase 5 — Product and recommendation integration

- Present “direct sun,” “filtered/partial,” “diffuse/overcast,” “structure/terrain shade,” “night,” and unknown only if user research supports the detail.
- Show confidence and source freshness without false decimal precision.
- Use exposure uncertainty in candidate equivalence bands.
- Keep safety/weather effects separate from comfort.
- Retire legacy `CoverageMask` only after migration of saved/demo routes.

## Data and calibration program

### Benchmark design

Build a versioned benchmark with route segments/timestamps spanning:

- dense urban cores, low-rise suburbs, open rural areas;
- forest singletrack, wide forest roads, parks, street-tree corridors;
- mountains, valleys, coasts, flat plains;
- deciduous leaf-on/leaf-off, evergreen, mixed canopy;
- morning/noon/evening and low/high Sun;
- clear, broken cloud, overcast;
- both hemispheres and high latitudes;
- mapped/unmapped/dated occluders.

Hold out entire cities/parks/acquisition campaigns. Random nearby point splits leak the same building/canopy geometry into train and test.

### Ground truth

Preferred:

- calibrated pyranometer or matched direct/diffuse radiation sensor;
- fisheye/hemispherical sky images with timestamp/orientation, under an explicit privacy protocol;
- lidar/canopy/building survey where legally usable;
- repeatable walking/running transects with synchronized GNSS and irradiance.

Secondary:

- human “direct solar disc visible?” labels;
- time-stamped shade photographs after faces/plates/private property are handled;
- official high-resolution orthophoto/lidar-derived labels;
- opt-in runner reports.

Record sensor position, height, orientation, clock error, weather, and GNSS uncertainty. A phone light sensor in a pocket is not scientific truth.

### Metrics

Astronomy:

- angular elevation/azimuth error vs SPA;
- sunrise/sunset transition error under the same defined convention;
- polar/no-event classification accuracy.

Radiation:

- direct and diffuse irradiance MAE/bias/RMSE;
- direct-beam event precision/recall;
- onset/offset timing error;
- calibration of predicted transmission/confidence.

Occlusion:

- blocker-class precision/recall;
- shadow boundary distance/time error;
- segment-length-weighted sun/shade F1/IoU;
- unknown coverage and abstention accuracy;
- error by source age/resolution/confidence.

Product:

- shade-fraction absolute error;
- comfort/recommendation regret;
- refresh/source-update churn;
- fraction of exposure penalty attributable to unsupported assumptions.

Always report strata; a model can excel in forests and fail in cities, or vice versa.

## Validation and test plan

### Solar scientific golden tests

- Generate a reference matrix from NREL SPA across years 2000–2100 (or the declared domain), latitudes −89° to +89°, longitudes including ±180°, solstices/equinoxes, and random UTC times.
- Require separate geometric/apparent comparisons under identical pressure/refraction inputs.
- Golden sunrise/sunset events define center/upper-limb/horizon precisely.
- Test polar day/night and grazing/tangent events where a coarse scan may miss or double count crossings.
- Test zenith/nadir azimuth as undefined/quality-limited.
- Test epoch modulo behavior before 1970 if supported.
- Test invalid lat/lon/time inputs.

### Solar property tests

- Azimuth/elevation are finite within declared domain.
- Geometric elevation remains in [−90°, 90°].
- Apparent correction is bounded and applied once.
- Solar position is continuous across UTC midnight and longitude ±180°.
- Event times are ordered, in-window, and alternate except valid polar/tangent cases.
- A smaller `sunWindows` scan step converges to the same crossings.
- Position at the equator/equinox and declination bounds satisfy astronomical invariants.

### OSM/geometry contract fixtures

- closed woodland way;
- relation with split outer ways;
- multiple disjoint outer rings;
- one and nested inner holes;
- reversed member direction/order;
- relation tags on relation, not members;
- invalid/unclosed relation;
- partial/timeout-like response;
- relation-only successful response;
- no woodland evidence;
- `natural=tree` and tree row;
- covered way/tunnel/arcade;
- building with `height`, `building:levels`, missing height;
- route/bbox crossing the antimeridian;
- high-latitude bbox;
- huge route bbox and query-budget rejection.

Expected output includes geometry, semantic evidence, completeness, warnings, and unknown—not only a boolean mask.

### Synthetic occlusion tests

- Flat horizon/no blockers yields transmission one when Sun is up.
- A ridge at azimuth/elevation blocks only the matching Sun direction.
- A rectangular building casts the correct opposite-direction shadow as time changes.
- A polygon hole admits direct beam.
- A tree east of route shades morning, not afternoon.
- Deciduous transmission differs by leaf state without changing astronomical geometry.
- Direct occlusion leaves nonzero diffuse exposure.
- Boundary refinement converges and summary shade length is sample-spacing invariant within tolerance.

### Integration/golden route tests

- Existing demo routes reprocessed with recorded source versions.
- A forest multipolygon containing a lake/trail clearing.
- Downtown east–west and north–south street canyons.
- Mountain valley with delayed local sunrise.
- Open lakeshore where low Sun must remain direct.
- Leaf-off deciduous park.
- Provider radiation missing while cloud fallback is used.
- All third-party providers unavailable while cached evidence is degraded.

### Field validation

- At least two acquisition campaigns per major stratum/season before defaulting advanced canopy/building modes.
- Synchronize predicted and observed transitions; manually review largest errors.
- Freeze benchmark and thresholds before tuning.
- Conduct prospective shadow runs after tuning, not only retrospective fitting.
- Audit geographic performance and unknown rates so data-rich cities do not define global quality.

## Observability

Emit privacy-preserving structured metrics:

- ephemeris implementation/version and reference-delta canary;
- number/type/freshness/resolution of occluder layers;
- OSM query status, duration, payload, parser completeness, relation/way/hole counts;
- public/provider cache hit/miss/stale and refresh reason;
- coverage evidence shares: woodland/tree/building/terrain/covered/unknown;
- dataset disagreement rates;
- radiation source/native interval/missingness;
- direct-beam transmission/confidence distributions;
- derived category transition count and boundary refinement count;
- fallback reason counts (cloud threshold, low-sun assumption, missing building height);
- legacy/new shade-fraction and comfort deltas;
- source-update recommendation churn.

Never log exact route geometry in routine telemetry. Use approved coarse region/terrain strata and pseudonymous benchmark IDs.

Alerts:

- a parsed relation count with zero assembled polygons;
- successful query classified all-open after any parse warning;
- sudden jump in unknown/open/tree distribution;
- OSM/public-provider rate-limit or timeout surge;
- occluder cache overwritten by lower completeness;
- radiation missingness above baseline;
- ephemeris golden canary drift;
- day/night disagreement between old/new semantics outside expected transition windows;
- shadow engine latency/cost breach.

## Rollout and rollback

1. Ship solar-definition fixes with shadow comparison and transition telemetry.
2. Ship provenance/completeness schema while keeping legacy UI categories.
3. Shadow radiation-aware exposure; review transition and comfort deltas.
4. Enable radiation mode for clear/open benchmarked routes at 5%, 25%, 100%.
5. Deploy corrected server-side OSM parsing as “woodland evidence,” not canopy truth.
6. Add raster fusion and display uncertainty; maintain an unknown/abstain state.
7. Shadow terrain/building occlusion only in eligibility regions with known data quality.
8. Roll out each occluder layer independently with a kill switch and source-version pin.
9. Add canopy transmission/phenology by stratum; never use one global flag for all regions/seasons.
10. Migrate saved masks with schema versioning; do not reinterpret legacy `tree` as measured transmission.

Rollback must preserve the critical correctness rules: do not return to double-counted horizon semantics or “unparsed means open.” A degraded radiation-only result is more reliable and honest than a silently corrupt rich result.

## Measurable acceptance criteria

### Correctness gates

- Geometric/apparent/upper-limb definitions are explicit in types and documentation; refraction is applied exactly once.
- Against NREL SPA reference cases, p99 solar-vector angular error ≤0.02° over the supported 2000–2100 domain. Test azimuth separately only outside a declared near-zenith/nadir guard (for example `sin(zenith) >= 0.01`), where azimuth is numerically meaningful.
- Under the chosen sunrise convention, event-time error vs the same SPA/reference definition ≤30 seconds for |latitude|≤72°; high-latitude behavior has separately documented tolerance.
- 100% of valid multipolygon fixtures preserve outer parts and inner holes.
- 0 incomplete/invalid/unparsed coverage responses are classified confidently open.
- Exposure category/irradiance is invariant to OSM relation member order/direction.
- Direct occlusion never forces diffuse irradiance to zero unless a separately validated enclosure/sky-view rule does so.

### Model-quality gates

- Radiation-aware direct-beam classification improves held-out F1 by ≥15 percentage points over the current cloud/elevation thresholds and reduces transition median absolute error.
- On a frozen cross-region benchmark, radiation-only direct irradiance MAE beats the cloud-cover baseline in every sufficiently sampled lead-time stratum.
- Corrected OSM + raster woodland evidence reaches ≥0.85 precision for “tree-cover evidence”; do not set a recall target until benchmark completeness is understood.
- Advanced eligible-region occlusion reaches segment-length-weighted direct-sun F1 ≥0.85 and median shadow-boundary error ≤20 m or ≤2 minutes, with both reported.
- Predicted 80% transmission/confidence intervals cover 75–85% of held-out measurements overall and are published by stratum.
- Unknown/abstained segments have lower error when excluded and are not silently reassigned for product metrics.

### Product/reliability gates

- ≥99.5% of exposure requests return validated evidence or an explicit degraded/unknown state.
- Public Overpass traffic from end-user clients is zero in production.
- OSM/geospatial source p95 generation stays within an agreed async budget (initial target: <5 s uncached, <300 ms cached); planning UI must not block on it.
- Cached occluder evidence has source/version/fetched-at for 100% of saved routes after migration.
- Exact route coordinates appear in 0 routine analytics/log events.
- A source refresh changes the recommended start only with a recorded input-diff reason; unexplained churn <1%.
- OSM attribution and license notices pass the repository’s legal/release audit.

Quantitative model thresholds are initial release gates. Freeze the benchmark and strata before tuning; revise thresholds only through an explicit evidence-backed decision.

## Privacy, cost, licensing, and reliability

### Route privacy

A route bbox or sequence of points can reveal a home, workplace, habits, or sensitive trail use. Current direct Overpass and weather requests disclose route-derived coordinates to third parties.

- Generate coverage server-side.
- Prefer reusable spatial tiles and k-anonymous/coarsened source requests where they preserve accuracy.
- Separate user/route identity from geospatial tile caches.
- Define raw request/geometry retention and deletion.
- Encrypt sensitive stored route geometry; restrict access.
- Never collect field photos/sensor traces without explicit consent, retention, redaction, and deletion controls.
- Avoid telemetry dimensions that reconstruct rare routes.

### Cost

Major cost drivers:

- OSM extract/provider/self-host infrastructure;
- global raster storage, tile preprocessing, and egress;
- DEM/lidar processing;
- building/canopy geometry and height enrichment;
- per-route horizon/occluder preprocessing;
- radiation variables and higher temporal resolution;
- field-data acquisition and labeling.

Precompute by spatial tile and source version, then attach route descriptors. Set per-route distance/area/complexity limits. Build an eligibility ladder: radiation everywhere, OSM semantics globally, raster where licensed/available, terrain/buildings/canopy only when quality and budget pass.

### Licensing

OpenStreetMap data is ODbL and requires attribution; derived-database/share-alike implications need counsel for combined occluder products: <https://www.openstreetmap.org/copyright>. ESA/USFS/DEM and any building provider have separate attribution/redistribution terms. Maintain a machine-readable provenance/license manifest and a user-visible attribution surface. Do not combine sources until compatibility and distribution obligations are recorded.

### Reliability

- Public Overpass load shedding is expected, not an exceptional bug.
- Raster and elevation sources can be stale or regionally absent.
- OSM completeness is heterogeneous.
- Provider radiation can be hourly/model-interpolated and uncertain.
- Building heights and canopy change over time.

Therefore:

- cache validated versioned data;
- retain last-known-good evidence;
- never upgrade unknown to open on failure;
- use layer-level circuit breakers;
- allow partial results;
- visibly degrade confidence;
- test provider/source removal;
- keep safety claims out of exposure language.

## Open decisions

1. Which precise sunrise/night convention should the product use: upper-limb astronomical horizon, apparent center, civil twilight, or a user-purpose-specific light threshold?
2. Is “night” a solar-disc state, an ambient-light state, or both?
3. Should comfort consume irradiance continuously while the UI keeps four categories?
4. What direct/diffuse radiation thresholds define runner-meaningful sun after field calibration?
5. Which source supplies global terrain horizon, and at what resolution/cost?
6. Is a hosted OSM extract, commercial vector provider, or self-hosted Overpass/PostGIS stack sustainable?
7. Can OSM-derived and raster-derived evidence be distributed together under compatible terms?
8. What source/version age makes woodland/building/canopy evidence stale?
9. How should leaf state be inferred when OSM leaf-cycle tags are absent?
10. Which regions have building height quality sufficient for shadow claims?
11. Should unknown conservatively display “possible sun” while comfort uses an uncertainty distribution?
12. How much route-detail exposure is acceptable to third-party raster/elevation services?
13. What field equipment/protocol is feasible, and who owns/deletes collected images/traces?
14. How should long shadows beyond the route bbox determine preprocessing radius without unbounded queries?
15. What product names avoid calling woodland membership “covered” or overcast conditions “shade”?

## Evidence and primary references

- NOAA Solar Calculation Details: equations, refraction assumptions, latitude/date caveats, and current unmaintained notice: <https://gml.noaa.gov/grad/solcalc/calcdetails.html>
- NREL Solar Position Algorithm and stated uncertainty/domain: <https://midcdmz.nrel.gov/spa/>
- NREL SPA technical report: <https://www.nrel.gov/docs/fy08osti/34302.pdf>
- Open-Meteo radiation/cloud variable definitions and validity intervals: <https://open-meteo.com/en/docs>
- OpenStreetMap woodland/forest tagging ambiguity: <https://wiki.openstreetmap.org/wiki/Forest>
- OpenStreetMap multipolygon outer/inner geometry model: <https://wiki.openstreetmap.org/wiki/Multipolygon>
- Overpass relation geometry/output model: <https://dev.overpass-api.de/overpass-doc/en/full_data/osm_types.html>
- Overpass public-instance capacity and backend guidance: <https://dev.overpass-api.de/overpass-doc/en/preface/commons.html>
- OpenStreetMap ODbL and attribution requirements: <https://www.openstreetmap.org/copyright>
- ESA WorldCover data access and 10 m 2021 land-cover dataset: <https://esa-worldcover.org/en/data-access>
- US Forest Service annual Tree Canopy Cover products and uncertainty: <https://data.fs.usda.gov/geodata/rastergateway/treecanopycover/>
- USGS 3D Elevation Program: <https://www.usgs.gov/3d-elevation-program>

## Definition of done

This plan is complete only when Runcast can distinguish astronomical daylight from direct-beam radiation and local occlusion; can explain which terrain, structure, vegetation, atmosphere, and fallback evidence produced each estimate; never treats missing/unparsed data as open; represents diffuse and uncertain exposure; and demonstrates on frozen field data that its result materially outperforms the current cloud-threshold plus forest-membership heuristic.
