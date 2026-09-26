import { access, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptLegacyRoute, parseGpx, routeGeometryIdentity } from '@runcast/core';
import { acquireCanopyEvidence } from '../apps/api/src/providers/usdaCanopy';
import centralParkLoopGpx from '../packages/core/src/data/centralParkLoopGpx';
import chicagoLakefrontTrailGpx from '../packages/core/src/data/chicagoLakefrontTrailGpx';
import griffithParkHollywoodSignBronsonGpx from '../packages/core/src/data/griffithParkHollywoodSignBronsonGpx';
import presidioCoastalTrailGpx from '../packages/core/src/data/presidioCoastalTrailGpx';

const filenames: Record<string, string> = {
  'central-park-loop': 'central-park-loop.canopy-v3.json',
  'chicago-lakefront-trail': 'chicago-lakefront-trail.canopy-v3.json',
  'griffith-park-hollywood-sign-bronson': 'griffith-park-hollywood-sign-bronson.canopy-v3.json',
  'presidio-coastal-trail': 'presidio-coastal-trail.canopy-v3.json',
};
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resume = process.argv.includes('--resume');
const demos = [
  {
    id: 'central-park-loop',
    name: 'Central Park Loop',
    gpx: centralParkLoopGpx,
  },
  {
    id: 'chicago-lakefront-trail',
    name: 'Lakefront Trail',
    gpx: chicagoLakefrontTrailGpx,
  },
  {
    id: 'griffith-park-hollywood-sign-bronson',
    name: 'Griffith Park',
    gpx: griffithParkHollywoodSignBronsonGpx,
  },
  {
    id: 'presidio-coastal-trail',
    name: 'Presidio Trail',
    gpx: presidioCoastalTrailGpx,
  },
];

for (const demo of demos) {
  const route = adaptLegacyRoute(parseGpx(demo.gpx, demo.id, demo.name));
  const coordinateHash = routeGeometryIdentity(route);
  const path = resolve(repositoryRoot, 'packages/core/src/data', filenames[route.id]);
  if (resume) {
    try {
      await access(path);
      process.stdout.write(`${route.id}: existing profile retained\n`);
      continue;
    } catch {
      // Missing profiles are generated below.
    }
  }
  const profile = await acquireCanopyEvidence(route, coordinateHash, {
    acquiredAt: Date.UTC(2026, 7, 29),
    retries: 5,
  });
  await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`);
  process.stdout.write(
    `${route.id}: ${profile.completeness}, ${profile.canopyPct.filter((value) => value !== null).length}/${profile.canopyPct.length}\n`,
  );
}
