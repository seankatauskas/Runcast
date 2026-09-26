import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const commitShaPattern = /^[0-9a-f]{40}$/i;
const imageDigestPattern = /@sha256:[0-9a-f]{64}$/i;

function addViolation(violations, file, line, rule, message) {
  violations.push({ file, line, rule, message });
}

function inspectWorkflow(file, source, violations) {
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const uses = line.match(/^\s*-?\s*uses:\s*['"]?([^\s'"#]+)['"]?/u)?.[1];
    if (uses && !uses.startsWith('./')) {
      if (uses.startsWith('docker://')) {
        if (!imageDigestPattern.test(uses.slice('docker://'.length))) {
          addViolation(
            violations,
            file,
            lineNumber,
            'immutable-action',
            `container action ${uses} must pin a sha256 digest`,
          );
        }
      } else {
        const separator = uses.lastIndexOf('@');
        const revision = separator === -1 ? '' : uses.slice(separator + 1);
        if (!commitShaPattern.test(revision)) {
          addViolation(
            violations,
            file,
            lineNumber,
            'immutable-action',
            `external action ${uses} must pin a full commit SHA`,
          );
        }
      }
    }

    const image = line.match(/^\s*image:\s*['"]?([^\s'"#]+)['"]?/u)?.[1];
    if (image && !imageDigestPattern.test(image)) {
      addViolation(
        violations,
        file,
        lineNumber,
        'immutable-image',
        `service image ${image} must pin a sha256 digest`,
      );
    }

    if (line.trimStart().startsWith('#')) continue;
    for (const invocation of line.matchAll(/\bnpx\b/gu)) {
      const command = line.slice(invocation.index);
      if (!/^npx\s+--no-install(?:\s|$)/u.test(command)) {
        addViolation(
          violations,
          file,
          lineNumber,
          'local-npx',
          'workflow npx commands must use --no-install',
        );
      }
    }
  }
}

function inspectDockerfile(file, source, violations) {
  const stages = new Set();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const from = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/iu);
    if (!from) continue;
    const [, image, stage] = from;
    if (
      image.toLowerCase() !== 'scratch' &&
      !stages.has(image) &&
      !imageDigestPattern.test(image)
    ) {
      addViolation(
        violations,
        file,
        index + 1,
        'immutable-image',
        `base image ${image} must pin a sha256 digest`,
      );
    }
    if (stage) stages.add(stage);
  }
}

function inspectComposeFile(file, source, violations) {
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const image = line.match(/^\s*image:\s*['"]?([^\s'"#]+)['"]?/u)?.[1];
    if (!image || imageDigestPattern.test(image)) continue;
    addViolation(
      violations,
      file,
      index + 1,
      'immutable-image',
      `service image ${image} must pin a sha256 digest`,
    );
  }
}

export function evaluateReleasePolicy({ workflows = {}, dockerfiles = {}, composeFiles = {} }) {
  const violations = [];
  for (const [file, source] of Object.entries(workflows)) {
    inspectWorkflow(file, source, violations);
  }
  for (const [file, source] of Object.entries(dockerfiles)) {
    inspectDockerfile(file, source, violations);
  }
  for (const [file, source] of Object.entries(composeFiles)) {
    inspectComposeFile(file, source, violations);
  }
  return violations;
}

function loadFiles(directory, names, prefix = '') {
  return Object.fromEntries(
    names.map((name) => [join(prefix, name), readFileSync(join(directory, name), 'utf8')]),
  );
}

export function loadReleasePolicySources(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const workflowDirectory = join(root, '.github', 'workflows');
  const workflowNames = readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/u.test(name));
  const rootNames = readdirSync(root);
  const dockerfileNames = rootNames.filter(
    (name) => name === 'Dockerfile' || name.startsWith('Dockerfile.'),
  );
  const composeNames = rootNames.filter((name) =>
    /^(?:docker-)?compose(?:\.[^.]+)?\.ya?ml$/u.test(name),
  );
  return {
    workflows: loadFiles(workflowDirectory, workflowNames, join('.github', 'workflows')),
    dockerfiles: loadFiles(root, dockerfileNames),
    composeFiles: loadFiles(root, composeNames),
  };
}

function main() {
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
  const violations = evaluateReleasePolicy(loadReleasePolicySources(repositoryRoot));
  if (violations.length === 0) {
    console.log('Release workflow policy passed.');
    return;
  }
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
