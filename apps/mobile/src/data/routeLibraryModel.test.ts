import { describe, expect, it } from 'vitest';
import type { RouteSummary } from '@runcast/contracts';
import {
  normalizedRouteName,
  reconcileRouteSummaries,
  staleRouteCacheIds,
} from './routeLibraryModel';

const summary: RouteSummary = {
  id: '2f272b14-601d-4be1-a219-e63967069aac',
  name: 'Server name',
  source: 'gpx',
  origin: 'cloud-gpx',
  providerId: null,
  geometryIdentity: 'geometry',
  distance: 5000,
  importStatus: 'ready',
  version: 1,
  createdAt: '2026-08-15T12:00:00.000Z',
  updatedAt: '2026-08-15T12:00:00.000Z',
};

describe('route library model', () => {
  it('normalizes names and rejects empty names', () => {
    expect(normalizedRouteName('  Morning   loop  ')).toBe('Morning loop');
    expect(() => normalizedRouteName('   ')).toThrow(/empty/);
  });

  it('applies rename overrides and deletion tombstones before hydration', () => {
    expect(
      reconcileRouteSummaries(
        [summary],
        [{ routeId: summary.id, kind: 'rename', name: 'Offline name', createdAt: 1 }],
      )[0].name,
    ).toBe('Offline name');
    expect(
      reconcileRouteSummaries(
        [summary],
        [{ routeId: summary.id, kind: 'delete', name: null, createdAt: 1 }],
      ),
    ).toEqual([]);
  });

  it('identifies stale route cache rows', () => {
    expect(staleRouteCacheIds(['one', 'two'], ['two', 'three'])).toEqual(['one']);
  });
});
