import { describe, expect, it } from 'vitest';
import { MAP_STYLES } from '@runcast/core';
import { mobileMapStyle } from './mobileMapStyle';

type TestLayer = {
  id: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
};

function layer(style: unknown, id: string): TestLayer {
  const layers = (style as { layers: TestLayer[] }).layers;
  const match = layers.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`Missing map layer ${id}`);
  return match;
}

describe('mobileMapStyle', () => {
  it('keeps the bundled light style unchanged', () => {
    expect(mobileMapStyle('light')).toBe(MAP_STYLES.light);
  });

  it('builds a bundled route-first dark style with visible geography', () => {
    const style = mobileMapStyle('dark') as unknown as {
      name: string;
      sources: Record<string, unknown>;
      layers: TestLayer[];
    };

    expect(style.name).toBe('Runcast Night Run');
    expect(style.layers).toHaveLength(55);
    expect(style.sources).toBe((MAP_STYLES.light as { sources: Record<string, unknown> }).sources);
    expect(layer(style, 'background').paint?.['background-color']).toBe('#080a0b');
    expect(layer(style, 'park').paint?.['fill-color']).toBe('#101613');
    expect(layer(style, 'water').paint?.['fill-color']).toBe('#09161a');
    expect(layer(style, 'highway_minor').paint?.['line-color']).toBe('#24282b');
  });

  it('uses a coherent low-glare label treatment', () => {
    const style = mobileMapStyle('dark');
    expect(layer(style, 'highway-name-minor').paint?.['text-color']).toBe('#92999c');
    expect(layer(style, 'highway-name-minor').paint?.['text-halo-color']).toBe(
      'rgba(8, 10, 11, 0.96)',
    );
    expect(layer(style, 'water_name_point_label').paint?.['text-color']).toBe('#78959b');
    expect(layer(style, 'road_shield_us').layout?.visibility).toBe('none');
  });
});
