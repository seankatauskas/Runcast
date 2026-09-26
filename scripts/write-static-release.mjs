import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function staticReleaseIdentity(environment = process.env) {
  return {
    service: 'runcast-legal',
    sha:
      environment.RENDER_GIT_COMMIT ??
      environment.GITHUB_SHA ??
      environment.RELEASE_SHA ??
      'development',
  };
}

export async function writeStaticRelease(outputDirectory, environment = process.env) {
  const destination = resolve(outputDirectory);
  await mkdir(destination, { recursive: true });
  await writeFile(
    resolve(destination, 'release.json'),
    `${JSON.stringify(staticReleaseIdentity(environment), null, 2)}\n`,
    'utf8',
  );
}

async function main() {
  const [outputDirectory] = process.argv.slice(2);
  if (!outputDirectory) {
    throw new Error('Usage: node scripts/write-static-release.mjs <output-directory>');
  }
  await writeStaticRelease(outputDirectory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
