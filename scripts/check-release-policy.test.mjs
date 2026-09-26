import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateReleasePolicy, loadReleasePolicySources } from './check-release-policy.mjs';

const actionSha = '0123456789abcdef0123456789abcdef01234567';
const imageDigest = 'sha256:' + 'a'.repeat(64);

describe('release workflow policy', () => {
  it('accepts the repository release configuration', () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
    expect(evaluateReleasePolicy(loadReleasePolicySources(repositoryRoot))).toEqual([]);
  });

  it('rejects mutable external actions while allowing local and commit-pinned actions', () => {
    const violations = evaluateReleasePolicy({
      workflows: {
        '.github/workflows/test.yml': [
          'steps:',
          '  - uses: actions/checkout@v4',
          `  - uses: actions/setup-node@${actionSha}`,
          '  - uses: ./actions/configure',
        ].join('\n'),
      },
    });
    expect(violations).toEqual([expect.objectContaining({ line: 2, rule: 'immutable-action' })]);
  });

  it('rejects unpinned workflow service and Compose images', () => {
    const violations = evaluateReleasePolicy({
      workflows: {
        '.github/workflows/test.yml': [
          'services:',
          '  postgres:',
          '    image: postgres:17-alpine',
          `    image: postgres:17-alpine@${imageDigest}`,
        ].join('\n'),
      },
      composeFiles: {
        'docker-compose.yml': 'services:\n  postgres:\n    image: postgres:17-alpine\n',
      },
    });
    expect(violations).toEqual([
      expect.objectContaining({ file: '.github/workflows/test.yml', rule: 'immutable-image' }),
      expect.objectContaining({ file: 'docker-compose.yml', rule: 'immutable-image' }),
    ]);
  });

  it('rejects unpinned Dockerfile base images', () => {
    const violations = evaluateReleasePolicy({
      dockerfiles: {
        Dockerfile: [
          'FROM node:22-alpine AS build',
          `FROM node:22-alpine@${imageDigest} AS runtime`,
          'FROM runtime AS final',
          'FROM scratch AS export',
        ].join('\n'),
      },
    });
    expect(violations).toEqual([expect.objectContaining({ line: 1, rule: 'immutable-image' })]);
  });

  it('requires local-only npx execution in workflows', () => {
    const violations = evaluateReleasePolicy({
      workflows: {
        '.github/workflows/test.yml': [
          'steps:',
          '  - run: npx expo-doctor',
          '  - run: npx --no-install expo config --type public',
        ].join('\n'),
      },
    });
    expect(violations).toEqual([expect.objectContaining({ line: 2, rule: 'local-npx' })]);
  });
});
