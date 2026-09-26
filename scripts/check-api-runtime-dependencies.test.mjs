import { describe, expect, it } from 'vitest';
import {
  repositoryRuntimeDependencyDifference,
  runtimeDependencyDifference,
} from './check-api-runtime-dependencies.mjs';

describe('API runtime dependency manifest', () => {
  it('matches the repository API and bundled workspace dependencies', () => {
    expect(repositoryRuntimeDependencyDifference()).toEqual({
      missing: [],
      extra: [],
      mismatched: [],
    });
  });

  it('reports missing, extra, and version-mismatched runtime packages', () => {
    expect(
      runtimeDependencyDifference({
        api: { dependencies: { '@runcast/core': '*', fastify: '1', jose: '2' } },
        core: { dependencies: { saxes: '1' } },
        contracts: { dependencies: { zod: '1' } },
        runtime: { dependencies: { fastify: '1', jose: '3', unused: '1' } },
      }),
    ).toEqual({
      missing: ['saxes', 'zod'],
      extra: ['unused'],
      mismatched: [{ name: 'jose', expected: '2', actual: '3' }],
    });
  });
});
