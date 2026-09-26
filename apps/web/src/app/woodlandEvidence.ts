import {
  assembleWoodlandEvidence,
  fetchWithDeadline,
  OVERPASS_TIMEOUT_MS,
  woodlandEvidenceForRoute,
  type OverpassWoodlandPayload,
  type PlanningRoute,
  type WoodlandEvidenceProfile,
} from '@runcast/core';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function routeBbox(route: PlanningRoute, paddingDegrees = 0.002): string {
  const latitudes = route.part.points.map((point) => point.lat);
  const longitudes = route.part.points.map((point) => point.lon);
  return `${Math.min(...latitudes) - paddingDegrees},${Math.min(...longitudes) - paddingDegrees},${Math.max(...latitudes) + paddingDegrees},${Math.max(...longitudes) + paddingDegrees}`;
}

/** Direct guest acquisition followed by the shared pure multipolygon normalizer. */
export async function fetchWoodlandEvidence(
  route: PlanningRoute,
  signal?: AbortSignal,
): Promise<WoodlandEvidenceProfile> {
  const query = `
    [out:json][timeout:20];
    (
      way["natural"="wood"](${routeBbox(route)});
      way["landuse"="forest"](${routeBbox(route)});
      relation["natural"="wood"](${routeBbox(route)});
      relation["landuse"="forest"](${routeBbox(route)});
    );
    out geom;`;
  try {
    const response = await fetchWithDeadline(
      OVERPASS_URL,
      {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      },
      OVERPASS_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
    const payload = (await response.json()) as OverpassWoodlandPayload;
    return woodlandEvidenceForRoute(
      route,
      assembleWoodlandEvidence(payload),
      'openstreetmap-overpass',
      Date.now(),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return woodlandEvidenceForRoute(
      route,
      { evidence: 'unknown', completeness: 'incomplete', polygons: [], reasons: ['FETCH_FAILED'] },
      'openstreetmap-overpass',
      null,
    );
  }
}
