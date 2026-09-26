# Attribution audit

Before external beta, verify the shipped map and route-source surfaces against current terms:

- OpenStreetMap attribution is visible wherever OSM-derived map/coverage data appears.
- OpenFreeMap and MapLibre attribution meets the selected style/library requirements.
- Open-Meteo attribution appears with forecast results and the privacy notice describes the request.
- USDA Forest Service Tree Canopy Cover v2025.6 attribution appears in the planner footer when estimated canopy filtering can affect sun intensity; the dataset year/version and 30 m source resolution remain discoverable.
- Strava branding, “connected” state, route display, token scopes, and disconnect behavior meet current API agreement requirements.

The planner footer includes the USDA Forest Service source; canopy is otherwise presented through the adjusted yellow sun-intensity strip rather than a separate map overlay or numeric UI labels. Confirm the footer credit remains visible before enabling `CANOPY_MODEL_MODE=active`. This checklist still requires a release-time review because provider terms and style licenses can change.
