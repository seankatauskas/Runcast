/**
 * Demo-route generator (run manually, output is committed).
 *
 * For each demo route:
 *   1. Real path geometry from OSM via the FOSSGIS foot-routing server
 *      (snaps to the actual trail/drive centerlines).
 *   2. Real elevations from the Open-Meteo elevation API (Copernicus DEM).
 *   3. A tree-coverage mask computed from OSM wood/forest polygons — the
 *      exact same logic the app applies to uploaded GPX, precomputed here
 *      so the bundled demos never depend on Overpass at runtime.
 *
 * Output: src/data/<id>.gpx and src/data/<id>.coverage.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../packages/core/src/data');
const UA = 'runcast-demo-route-generator/0.1 (one-shot, portfolio project)';
const ROUTING = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';
const OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const MASK_RESOLUTION = 50; // must match src/io/overpass.ts

const ROUTES = [
  {
    id: 'lakefront',
    name: 'Chicago Lakefront Trail',
    // Montrose Harbor → Museum Campus
    waypoints: [
      [-87.6381, 41.9633],
      [-87.609, 41.8626],
    ],
  },
  {
    id: 'central-park',
    name: 'Central Park Loop',
    // Columbus Circle, counterclockwise around the park drives.
    waypoints: [
      [-73.9812, 40.7686],
      [-73.9697, 40.786],
      [-73.958, 40.7969],
      [-73.9495, 40.7967],
      [-73.958, 40.7838],
      [-73.9722, 40.767],
      [-73.9812, 40.7686],
    ],
  },
];

/* ---- geometry helpers (mirrors src/engine/geo.ts) ---- */

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + haversine(points[i - 1], points[i]));
  }
  return out;
}

function positionAt(points, cum, d) {
  if (d <= 0) return points[0];
  const total = cum[cum.length - 1];
  if (d >= total) return points[points.length - 1];
  let i = cum.findIndex((c) => c > d) - 1;
  const t = (d - cum[i]) / (cum[i + 1] - cum[i]);
  return {
    lat: points[i].lat + (points[i + 1].lat - points[i].lat) * t,
    lon: points[i].lon + (points[i + 1].lon - points[i].lon) * t,
  };
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/* ---- data sources ---- */

async function getJson(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, ...init });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = 2000 * 2 ** attempt;
      console.log(`  ${res.status} from server, retrying in ${wait / 1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${res.status} from ${url.slice(0, 80)}`);
  }
}

/**
 * Douglas-Peucker simplification (tolerance in meters, approximated on a
 * local flat projection — fine at city scale). Fewer points = fewer
 * elevation calls and a leaner bundle, with no visible geometry loss.
 */
function simplify(points, toleranceM) {
  const cosLat = Math.cos(rad(points[0].lat));
  const tol2 = (toleranceM / 111320) ** 2; // meters → degrees², lat-scaled
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const ax = points[lo].lon * cosLat;
    const ay = points[lo].lat;
    const bx = points[hi].lon * cosLat;
    const by = points[hi].lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1;
    let maxI = -1;
    for (let i = lo + 1; i < hi; i++) {
      const px = points[i].lon * cosLat - ax;
      const py = points[i].lat - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tol2) {
      keep[maxI] = 1;
      stack.push([lo, maxI], [maxI, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

async function fetchGeometry(waypoints) {
  const coords = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const body = await getJson(
    `${ROUTING}/${coords}?overview=full&geometries=geojson&steps=false&continue_straight=true`,
  );
  const route = body.routes[0];
  const raw = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const points = simplify(raw, 2);
  console.log(
    `  geometry: ${(route.distance / 1000).toFixed(2)} km, ${raw.length} points → ${points.length} simplified`,
  );
  return points;
}

async function fetchElevations(points) {
  const eles = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const body = await getJson(
      'https://api.open-meteo.com/v1/elevation' +
        `?latitude=${batch.map((p) => p.lat.toFixed(6)).join(',')}` +
        `&longitude=${batch.map((p) => p.lon.toFixed(6)).join(',')}`,
    );
    eles.push(...body.elevation);
    await new Promise((r) => setTimeout(r, 1500)); // be polite
  }
  console.log(`  elevations: ${eles.length} (${Math.min(...eles)}–${Math.max(...eles)} m)`);
  return eles;
}

async function fetchCanopyMask(points) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const bbox = `${Math.min(...lats) - 0.002},${Math.min(...lons) - 0.002},${Math.max(...lats) + 0.002},${Math.max(...lons) + 0.002}`;
  // Richer than the app's runtime query (wood/forest polygons only): the
  // generator can afford to also pull individual mapped street trees and
  // tree rows, which is how OSM actually models canopy along park drives
  // and urban trails. Without them Central Park scores 3% tree cover.
  const query = `
    [out:json][timeout:90];
    (
      way["natural"="wood"](${bbox});
      way["landuse"="forest"](${bbox});
      relation["natural"="wood"](${bbox});
      relation["landuse"="forest"](${bbox});
      way["natural"="tree_row"](${bbox});
      node["natural"="tree"](${bbox});
    );
    out geom;`;
  let body;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      body = await getJson(mirror, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      break;
    } catch (err) {
      console.log(`  ${mirror.split('/')[2]} failed (${err.message}), trying next mirror…`);
    }
  }
  if (!body) throw new Error('all Overpass mirrors failed');

  const rings = [];
  const treeRows = [];
  const trees = [];
  for (const el of body.elements) {
    if (el.type === 'node' && el.tags?.natural === 'tree') {
      trees.push({ lat: el.lat, lon: el.lon });
    } else if (el.tags?.natural === 'tree_row' && el.geometry?.length >= 2) {
      treeRows.push(el.geometry);
    } else if (el.geometry?.length >= 3) {
      rings.push(el.geometry);
    }
    for (const m of el.members ?? []) {
      if (m.role === 'outer' && m.geometry?.length >= 3) rings.push(m.geometry);
    }
  }

  // Local flat projection for distance checks (meters).
  const cosLat = Math.cos(rad(points[0].lat));
  const M = 111320;
  const proj = (p) => ({ x: p.lon * cosLat * M, y: p.lat * M });
  const treePts = trees.map(proj);
  const rowSegs = treeRows.flatMap((row) => {
    const pr = row.map(proj);
    return pr.slice(1).map((b, i) => [pr[i], b]);
  });
  const dist2ToSeg = (p, [a, b]) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-9)),
    );
    return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
  };

  const TREE_RADIUS2 = 18 ** 2; // a street tree shades ~18 m of path
  const ROW_RADIUS2 = 12 ** 2;
  const cum = cumulative(points);
  const n = Math.floor(cum[cum.length - 1] / MASK_RESOLUTION) + 1;
  const values = [];
  for (let i = 0; i < n; i++) {
    const p = positionAt(points, cum, i * MASK_RESOLUTION);
    let covered = rings.some((r) => pointInRing(p, r));
    if (!covered) {
      const pp = proj(p);
      // Two or more mapped trees nearby = a genuinely treed stretch;
      // one lone tree doesn't shade 50 m of trail.
      let near = 0;
      for (const t of treePts) {
        if ((t.x - pp.x) ** 2 + (t.y - pp.y) ** 2 < TREE_RADIUS2 && ++near >= 2) break;
      }
      covered = near >= 2 || rowSegs.some((s) => dist2ToSeg(pp, s) < ROW_RADIUS2);
    }
    values.push(covered ? 'tree' : 'open');
  }
  const treePct = Math.round((values.filter((v) => v === 'tree').length / n) * 100);
  console.log(
    `  canopy: ${rings.length} polygons, ${treeRows.length} tree rows, ${trees.length} trees → ${treePct}% of route under canopy`,
  );
  return { resolution: MASK_RESOLUTION, values };
}

/* ---- GPX output ---- */

function toGpx(name, points, eles) {
  const pts = points
    .map(
      (p, i) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${eles[i].toFixed(1)}</ele></trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="runcast scripts/fetch-routes.mjs (OSM via FOSSGIS routing; elevation: Open-Meteo/Copernicus DEM)" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

await mkdir(OUT_DIR, { recursive: true });
for (const def of ROUTES) {
  console.log(`${def.name}:`);
  const points = await fetchGeometry(def.waypoints);
  const eles = await fetchElevations(points);
  const mask = await fetchCanopyMask(points);
  const gpx = toGpx(def.name, points, eles);
  await writeFile(join(OUT_DIR, `${def.id}.gpx`), gpx);
  // TS string module alongside: bundler-agnostic (Metro has no ?raw).
  const tsName = def.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Gpx';
  await writeFile(
    join(OUT_DIR, `${tsName}.ts`),
    `// Generated from ${def.id}.gpx by scripts/fetch-routes.mjs — do not edit.\nexport default ${JSON.stringify(gpx)};\n`,
  );
  await writeFile(join(OUT_DIR, `${def.id}.coverage.json`), JSON.stringify(mask));
  console.log(`  wrote ${def.id}.gpx, ${tsName}.ts, coverage.json`);
}
console.log('done');
