import { contentIdentity } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import {
  parseAndVerifyPlanningBundle,
  planningBundleIsEnvironmentallyValid,
} from './planningBundle';
import { fixtureBundleV2, fixtureBundleV3, NOW } from './planningBundle.fixtures';

describe('current planning bundle verification', () => {
  it('rejects invalid JSON, old readers and strict schema additions', () => {
    expect(() => parseAndVerifyPlanningBundle('{')).toThrow(/valid JSON/);
    expect(() => parseAndVerifyPlanningBundle(fixtureBundleV2())).toThrow(/reader schema 3/);
    expect(() => parseAndVerifyPlanningBundle({ ...fixtureBundleV3(), unexpected: true })).toThrow(
      /reader schema 3/,
    );
  });
  it('verifies route, environment, forecast, manifest and bundle identities', () => {
    const valid = fixtureBundleV3();
    expect(parseAndVerifyPlanningBundle(JSON.stringify(valid))).toEqual(valid);
    const route = structuredClone(valid);
    route.route.data.name = 'tampered';
    expect(() => parseAndVerifyPlanningBundle(route)).toThrow(/route content identity/);
    const canopy = structuredClone(valid);
    canopy.environment.canopy.canopyPct[0] = 99;
    expect(() => parseAndVerifyPlanningBundle(canopy)).toThrow(/environment content identity/);
    const forecast = structuredClone(valid);
    forecast.forecast.data.provider = 'tampered';
    forecast.forecast.contentHash = contentIdentity({ data: forecast.forecast.data });
    expect(() => parseAndVerifyPlanningBundle(forecast)).toThrow(/normalized forecast/);
    const manifest = structuredClone(valid);
    manifest.manifest.evaluatorBuild = 'tampered';
    expect(() => parseAndVerifyPlanningBundle(manifest)).toThrow(/manifest content identity/);
    const identity = structuredClone(valid);
    const { contentHash: _hash, ...body } = identity.manifest;
    body.bundleId = '0'.repeat(64);
    identity.manifest = { ...body, contentHash: contentIdentity(body) };
    expect(() => parseAndVerifyPlanningBundle(identity)).toThrow(/bundle content identity/);
  });
  it('uses artifact validity to disable expired environmental evaluation', () => {
    const bundle = fixtureBundleV3();
    const cached = {
      userId: 'alice',
      routeId: 'route-1',
      etag: 'etag',
      body: JSON.stringify(bundle),
      bundle,
      installedAt: NOW,
    };
    expect(planningBundleIsEnvironmentallyValid(cached, NOW)).toBe(true);
    expect(planningBundleIsEnvironmentallyValid(cached, NOW + 3_600_001)).toBe(false);
  });
});
