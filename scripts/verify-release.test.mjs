import { describe, expect, it } from 'vitest';
import { evaluateDeployment } from './verify-release.mjs';

const sha = '0123456789abcdef';
const environment = 'production';
const planner = {
  mode: 'current',
  bundleReader: 3,
  canopyModelMode: 'active',
};

function healthyDeployment() {
  return {
    release: { status: 'ok', release: { sha, environment }, planner: { ...planner } },
    ready: { status: 'ready', release: { sha, environment }, planner: { ...planner } },
    cron: { status: 'ok', schedulerRelease: { sha, environment } },
    legal: { service: 'runcast-legal', sha },
  };
}

describe('evaluateDeployment', () => {
  it('accepts only an authoritative API and fresh scheduler from the expected release', () => {
    expect(evaluateDeployment(healthyDeployment(), sha, environment)).toEqual({
      ok: true,
      releaseMatches: true,
      readyMatches: true,
      cronMatches: true,
      legalMatches: true,
    });
  });

  it('accepts the supported open-sky canopy kill switch', () => {
    const deployment = healthyDeployment();
    deployment.ready.planner.canopyModelMode = 'off';
    deployment.release.planner.canopyModelMode = 'off';
    expect(evaluateDeployment(deployment, sha, environment).ok).toBe(true);
  });

  it.each([
    ['an old API release', (value) => (value.release.release.sha = 'old')],
    ['retired planner mode', (value) => (value.release.planner.mode = 'legacy-rollback')],
    ['an obsolete reader', (value) => (value.ready.planner.bundleReader = 2)],
    ['retired canopy mode', (value) => (value.ready.planner.canopyModelMode = 'shadow')],
    ['a stale scheduler', (value) => (value.cron.status = 'stale')],
    ['an old scheduler release', (value) => (value.cron.schedulerRelease.sha = 'old')],
    ['an old legal release', (value) => (value.legal.sha = 'old')],
  ])('rejects %s', (_label, mutate) => {
    const deployment = healthyDeployment();
    mutate(deployment);
    expect(evaluateDeployment(deployment, sha, environment).ok).toBe(false);
  });
});
