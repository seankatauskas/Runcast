import { describe, expect, it } from 'vitest';
import { canonicalJson, contentIdentity, routeGeometryIdentity, sha256Hex } from './identity';

describe('canonical planning content identity', () => {
  it('sorts object keys recursively without changing array order', () => {
    expect(canonicalJson({ z: 1, a: { y: true, x: [3, 2] } })).toBe(
      '{"a":{"x":[3,2],"y":true},"z":1}',
    );
  });

  it('matches standard SHA-256 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('has stable identities for semantically identical object insertion order', () => {
    expect(contentIdentity({ b: 2, a: 1 })).toBe(contentIdentity({ a: 1, b: 2 }));
  });

  it('rejects cycles and non-finite numbers', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => canonicalJson(value)).toThrow(/cyclic/);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/);
  });
});

describe('routeGeometryIdentity', () => {
  const points = [
    { lat: 41.9, lon: -87.6, elevationM: 181 },
    { lat: 41.91, lon: -87.61, elevationM: null },
  ];

  it('ignores mutable route metadata', () => {
    expect(routeGeometryIdentity({ part: { points } })).toBe(
      routeGeometryIdentity({ part: { points: points.map((point) => ({ ...point })) } }),
    );
  });

  it('changes for an exact coordinate or elevation change', () => {
    expect(
      routeGeometryIdentity({
        part: { points: [{ ...points[0], elevationM: 182 }, points[1]] },
      }),
    ).not.toBe(routeGeometryIdentity({ part: { points } }));
    expect(
      routeGeometryIdentity({
        part: { points: [{ ...points[0], lat: 41.900001 }, points[1]] },
      }),
    ).not.toBe(routeGeometryIdentity({ part: { points } }));
  });
});
