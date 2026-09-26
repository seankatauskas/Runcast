import { contentIdentity } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import {
  cloudRouteFromDescriptor,
  hydrateCloudRoute,
  projectCloudRoutes,
  serializeCloudRoute,
} from './cloudRoutes';
import { fixtureBundleV3, NOW } from './planningBundle.fixtures';
const routeId = '00000000-0000-4000-8000-000000000001';
const bundle = fixtureBundleV3(routeId);
const summary = {
  id: routeId,
  name: 'Lakefront',
  source: 'gpx',
  origin: 'cloud-gpx',
  providerId: null,
  geometryIdentity: 'geometry',
  distance: 1000,
  importStatus: 'ready',
  version: 1,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
} as const;
const descriptor = {
  summary,
  timezone: 'America/Chicago',
  route: bundle.route,
  woodlandEvidence: bundle.environment.coverage,
};
describe('single cloud route snapshot', () => {
  it('provides geometry and timezone while current weather is preparing', () => {
    const row = {
      ...cloudRouteFromDescriptor('alice', descriptor),
      syncState: 'preparing' as const,
    };
    expect(hydrateCloudRoute(serializeCloudRoute(row), 'alice')).toEqual(row);
    expect(row.content.kind).toBe('route');
    expect(row.timezone).toBe('America/Chicago');
  });
  it('retains a verified V3 bundle when route geometry matches, without serializing it twice', () => {
    const row = {
      ...cloudRouteFromDescriptor('alice', descriptor),
      content: {
        kind: 'planning' as const,
        planning: {
          userId: 'alice',
          routeId,
          etag: '"v3"',
          body: JSON.stringify(bundle),
          bundle,
          installedAt: NOW,
        },
      },
    };
    const refreshed = cloudRouteFromDescriptor('alice', descriptor, row);
    expect(refreshed.content.kind).toBe('planning');
    const stored = JSON.parse(serializeCloudRoute(refreshed));
    expect(stored.content.planning.bundle).toBeUndefined();
    expect(hydrateCloudRoute(JSON.stringify(stored), 'alice')).toEqual(refreshed);
    expect(() => hydrateCloudRoute(JSON.stringify(stored), 'bob')).toThrow(/another account/);
  });
  it('preserves planning on name-only changes while exposing the latest summary', () => {
    const planning = {
      userId: 'alice',
      routeId,
      etag: '"v3"',
      body: JSON.stringify(bundle),
      bundle,
      installedAt: NOW,
    };
    const prior = {
      ...cloudRouteFromDescriptor('alice', descriptor),
      content: { kind: 'planning' as const, planning },
    };
    const data = { ...bundle.route.data, name: 'Renamed' };
    const next = cloudRouteFromDescriptor(
      'alice',
      {
        ...descriptor,
        summary: { ...summary, name: 'Renamed' },
        route: { ...bundle.route, data, contentHash: contentIdentity({ data }) },
      },
      prior,
    );
    expect(next.content).toEqual(prior.content);
    expect(next.summary.name).toBe('Renamed');
  });
  it('drops an incompatible planning artifact but keeps the new geometry', () => {
    const row = {
      ...cloudRouteFromDescriptor('alice', descriptor),
      content: {
        kind: 'planning' as const,
        planning: {
          userId: 'alice',
          routeId,
          etag: '"v3"',
          body: JSON.stringify(bundle),
          bundle,
          installedAt: NOW,
        },
      },
    };
    const data = {
      ...bundle.route.data,
      part: {
        points: bundle.route.data.part.points.map((point, index) =>
          index === 0 ? { ...point, lat: point.lat + 0.1 } : point,
        ),
      },
    };
    const updated = cloudRouteFromDescriptor(
      'alice',
      { ...descriptor, route: { ...bundle.route, data, contentHash: contentIdentity({ data }) } },
      row,
    );
    expect(updated.content.kind).toBe('route');
    expect(updated.syncState).toBe('unavailable');
    expect(updated.timezone).toBe('America/Chicago');
  });
  it('projects optimistic names and deletions without changing hashed content', () => {
    const row = cloudRouteFromDescriptor('alice', descriptor);
    const renamed = projectCloudRoutes(
      [row],
      [summary],
      [{ routeId, kind: 'rename', name: 'Latest', createdAt: 2 }],
    );
    expect(renamed[0].summary.name).toBe('Latest');
    expect(renamed[0].content).toBe(row.content);
    expect(projectCloudRoutes([row], [summary], [])[0].summary.name).toBe('Lakefront');
    expect(
      projectCloudRoutes([row], [summary], [{ routeId, kind: 'delete', name: null, createdAt: 3 }]),
    ).toEqual([]);
    expect(projectCloudRoutes([row], [], [])).toEqual([]);
  });
});
