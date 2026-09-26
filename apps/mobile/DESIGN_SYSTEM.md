# Runcast mobile design system

Runcast is a pre-run decision tool. Every screen should answer **when should I
run, and what will change along the way?** before exposing detailed analysis.

## Design direction: calm performance instrument

Runcast should feel like a focused piece of running equipment: precise enough
to trust, calm enough to read before a run, and native enough to disappear in
the hand. The signature is a luminous route line paired with compact,
left-to-right condition telemetry. It is not a generic weather dashboard.

- Recommendations are the hero. A selected time is an editable plan, not a
  substitute for the recommendation.
- Maps and route telemetry may be dense; surrounding chrome stays quiet.
- Use one raised surface for one decision. Prefer dividers and grouped rows to
  nests of individual cards.
- Primary teal buttons are reserved for committing a decision. Browsing,
  editing, and disclosure actions use secondary or ghost treatments.
- Motion confirms spatial or state changes and respects Reduce Motion. Do not
  animate decoration indefinitely.

## Product hierarchy

1. Lead with the recommended run window and its advantage.
2. Let the start-time curve explain when conditions improve.
3. Show changing conditions along the route as separate, linked signals.
4. Keep assumptions and detailed splits below the core decision.

### Explorer composition

Explorer is a map-first workspace, not a dashboard. The route should own at
least half of a standard phone viewport. A single `cockpit` dock sits over
the map and contains, in order: the recommendation, the start-quality window,
three selected-run signals, editable start and pace, and one primary action.
Do not place a light card inside that dock or repeat the detailed Planner
ribbon there.

The route selector is a compact map utility, not a page title or primary
action. Keep its surface quiet; inside the route menu, a checkmark and stronger
label are sufficient to identify the active route without a filled selection
block.

The start-quality window communicates the shape of the decision, including a
flat window when candidates are equivalent. The teal mark identifies the
recommended candidate; it is not a decorative sparkline. Selecting the
recommendation updates the planned start before the primary action becomes
“View run plan.” Detailed along-route telemetry remains progressive disclosure
in Planner.

Explorer's recommendation and compact quality curve are scoped to the route's
current local day while its acceptable start window remains open. At the
route-local end of that window, the decision card advances to tomorrow and
labels the recommendation accordingly. Planner retains its explicit
Today/Tomorrow comparison.

The compact weather deck under the Explorer recommendation describes that
displayed Best Start run, not a hidden selected start. Explore's primary action
uses that recommendation and applies it only when pressed. Keep “Choose another
time,” Pace, and the Best Start plan action on one compact action rail; the first
two remain quiet while the plan action carries the filled commitment treatment.
A custom time opens in Planner, where it becomes the explicit Selected Run.

The compact quality curve is also a direct start control. Tapping or scrubbing a
bar changes the hero to `SELECTED TIME`, uses semantic foreground for the
selected bar and status dot, updates the deck to `SELECTED RUN`, and points the
primary action at that start. The teal Best Start remains visible; selecting it
returns the dock to recommendation mode without adding a separate reset button.

### Planner spatial explanation

Keep “Along the route” as a separate progressive-disclosure surface after the
selected run. It pairs the route thumbnail and linked focus/play readout with
the taller route-condition strip, so spatial detail does not compete with the
primary start decision. The strip keeps its distinct lane heights and includes
the neutral `HILLS` silhouette when elevation data is available.

## Color roles

All mobile colors live in `src/theme.ts` and must be consumed through a
semantic `Chrome` role.

- **Teal** is the Runcast brand. It means action, selection, route, best time,
  and the current point of focus.
- **Coral** means feels-like temperature. Temperature does not use a rainbow.
- **Amber** means direct sun or a warning requiring attention.
- **Neutral grey** means elevation, wind, shade, and supporting structure.
- Red is reserved for destructive or dangerous states.

Weather warnings use a narrow semantic signal rather than a filled badge or a
tinted card. On the map, warnings appear as a compact, content-width pill with
no shadow; tapping the pill opens the same stable detail sheet used by Planner.
The warning hue identifies the condition and its peak measurement while the
surface, title, and disclosure affordance stay neutral. This keeps hazards
noticeable without competing with the selected-run decision surface.

Do not add a new color to distinguish a new metric. First give the metric its
own label, lane, shape, or position.

Light mode uses a neutral fog scale so white controls and surfaces remain
visibly elevated without making the interface read green. `controlActive`
is the luminous teal used behind dark button text; `route` is a deeper teal
chosen for contrast over land, water, and parks. They share a hue and a meaning,
but they are not interchangeable color values.

`border` is a quiet structural edge. `borderStrong` is reserved for functional
boundaries and exposed overlays where the edge itself must remain visible; do
not apply it to every card. Basemap colors are cartographic tokens in
`@runcast/core` and remain neutral so the weather signals keep their meaning.

`cockpit`, `cockpitRaised`, and their related roles form a coordinated
map-overlay material that resolves with the selected appearance. This keeps map
controls and the run brief visually connected without placing dark-mode chrome
over the light map.

## Component grammar

Reusable controls and surfaces live in `src/design/Primitives.tsx`; compact
icons live in `src/design/Icon.tsx`.

- `Surface` groups one idea, not every individual number.
- `SectionHeader` introduces a new level of information.
- `PillButton` is for named choices such as routes.
- `IconButton` is for compact, familiar actions.
- `ActionButton` advances the primary decision.

`ActionButton` variants communicate hierarchy: `primary` commits, `secondary`
edits or browses, `ghost` discloses, and `danger` is destructive. A screen
should rarely show more than one primary action in the same visual group.

Important controls use a minimum 44-point target. Icons use the shared 2-point
line language; do not introduce emoji or platform-dependent text glyphs.

Secondary screens use compact native navigation bars and grouped rows. A route
list includes the route's actual geometry; it must not degrade into a stack of
interchangeable text cards. Segmented preferences use a neutral selected
material so the brand color remains reserved for routes and consequential
actions.

## Data visualization

The forecast ribbon is the signature component. Distance always runs left to
right, and the selected-run summary, ribbon, and splits remain visually linked.

Each measurement gets its own labeled lane:

- `SUN`: full-height amber sections show likely exposure, using one color
  intensity for the whole run based on the time-weighted average normalized shortwave
  radiation (`MIN`, `LOW`, `MOD`, or `HIGH`). Standard background gaps indicate
  possible shade from mapped woodland. Unknown woodland evidence is shown
  conservatively as sun rather than promising shade. No pattern, cover
  percentage, or direct/diffuse-light encoding belongs in the strip.
- `FEELS`: a single coral line from normalized apparent temperature with
  visible minimum and maximum values.
- `RAIN`: a teal probability area on a fixed 0–100% domain with a stronger current
  precipitation-rate overlay.
- `WIND`: the current plot uses ambient wind relative to route direction on
  a fixed ±12 m/s scale. `HEAD` is above calm and `TAIL` is below it; signed
  ticks show crosswind and a diamond marks peak gust. Apparent airflow and the
  uncalibrated resistance model belong in expanded professional details.
  Never layer temperature and elevation into the same plotting area. Use a
  stable minimum temperature domain so small changes do not look dramatic.

## Typography and spacing

Manrope is reserved for times, scores, temperatures, distances, and pace.
System type carries labels and explanation. Uppercase eyebrow labels introduce
structure; they should not carry complete sentences and should not be repeated
when a direct title already establishes the hierarchy.

Use the 4-point `SP` scale, shared radii, and shared shadow token. Avoid raw
spacing, radius, shadow, or color values inside components.
