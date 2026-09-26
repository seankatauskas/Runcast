import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function externalDependencies(manifest) {
  return Object.entries(manifest.dependencies ?? {}).filter(
    ([name]) => !name.startsWith('@runcast/'),
  );
}

export function runtimeDependencyDifference({ api, core, contracts, runtime }) {
  const expected = new Map([
    ...externalDependencies(api),
    ...externalDependencies(core),
    ...externalDependencies(contracts),
  ]);
  const actual = new Map(externalDependencies(runtime));
  return {
    missing: [...expected.keys()].filter((name) => !actual.has(name)).sort(),
    extra: [...actual.keys()].filter((name) => !expected.has(name)).sort(),
    mismatched: [...expected.entries()]
      .filter(([name, version]) => actual.has(name) && actual.get(name) !== version)
      .map(([name, version]) => ({ name, expected: version, actual: actual.get(name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function manifest(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

export function repositoryRuntimeDependencyDifference() {
  return runtimeDependencyDifference({
    api: manifest('../apps/api/package.json'),
    core: manifest('../packages/core/package.json'),
    contracts: manifest('../packages/contracts/package.json'),
    runtime: manifest('../apps/api/runtime/package.json'),
  });
}

function main() {
  const difference = repositoryRuntimeDependencyDifference();
  if (difference.missing.length || difference.extra.length || difference.mismatched.length) {
    throw new Error(
      `API runtime dependency manifest drifted (missing: ${difference.missing.join(', ') || 'none'}; extra: ${difference.extra.join(', ') || 'none'}; mismatched: ${difference.mismatched.map(({ name, expected, actual }) => `${name} expected ${expected}, got ${actual}`).join(', ') || 'none'})`,
    );
  }
  console.log('API runtime dependencies match the owned package manifests.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
