import { describe, expect, it } from 'vitest';
import { MAP_STYLES } from './theme';

type StyleLayer = { id: string; paint?: Record<string, unknown> };

function layer(id: string): StyleLayer {
  const style = MAP_STYLES.light as { layers: StyleLayer[] };
  const match = style.layers.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`Missing map layer ${id}`);
  return match;
}

describe('Runcast light map style', () => {
  it('bundles the complete Coastal Mist style and OpenFreeMap resources', () => {
    const style = MAP_STYLES.light as {
      name: string;
      sources: Record<string, { url?: string }>;
      sprite: string;
      glyphs: string;
      layers: StyleLayer[];
    };

    expect(style.name).toBe('Runcast Coastal Mist');
    expect(style.layers).toHaveLength(55);
    expect(style.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
    expect(style.sprite).toContain('tiles.openfreemap.org');
    expect(style.glyphs).toContain('tiles.openfreemap.org');
  });

  it('preserves a useful hierarchy between geography and transportation', () => {
    expect(layer('background').paint?.['background-color']).toBe('#e4eae8');
    expect(layer('water').paint?.['fill-color']).toBe('#c8d7da');
    expect(layer('park').paint?.['fill-color']).toBe('#d4e2d6');
    expect(layer('building').paint?.['fill-outline-color']).toBe('#bdcac6');
    expect(layer('highway_minor').paint?.['line-color']).toBe('#f7f9f8');
    expect(layer('highway_major_casing').paint?.['line-color']).toBe('#b8c6c1');
  });

  it('keeps the existing remote dark style unchanged', () => {
    expect(MAP_STYLES.dark).toBe('https://tiles.openfreemap.org/styles/dark');
  });
});
