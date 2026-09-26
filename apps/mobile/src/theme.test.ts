import { describe, expect, it } from 'vitest';
import { MAP_STYLES } from '@runcast/core';
import { LIGHT } from './theme';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function mapColor(layerId: string, property: string): string {
  const style = MAP_STYLES.light as {
    layers: { id: string; paint?: Record<string, unknown> }[];
  };
  const value = style.layers.find((layer) => layer.id === layerId)?.paint?.[property];
  if (typeof value !== 'string') throw new Error(`Missing ${property} on map layer ${layerId}`);
  return value;
}

describe('light theme contrast', () => {
  it('keeps every small-text role readable on raised surfaces', () => {
    for (const color of [LIGHT.text, LIGHT.textSecondary, LIGHT.textFaint]) {
      expect(contrast(color, LIGHT.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(LIGHT.controlActiveText, LIGHT.controlActive)).toBeGreaterThanOrEqual(4.5);
    for (const color of [LIGHT.cockpitText, LIGHT.cockpitTextSecondary]) {
      expect(contrast(color, LIGHT.cockpit)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(LIGHT.cockpitAccentText, LIGHT.cockpitAccent)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives functional edges an independently visible keyline', () => {
    expect(contrast(LIGHT.borderStrong, LIGHT.surfaceRaised)).toBeGreaterThanOrEqual(3);
    expect(contrast(LIGHT.cockpitBorder, LIGHT.cockpit)).toBeGreaterThanOrEqual(3);
  });

  it('separates the app canvas and muted controls from white cards', () => {
    expect(contrast(LIGHT.bg, LIGHT.surfaceRaised)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(LIGHT.surfaceMuted, LIGHT.surfaceRaised)).toBeGreaterThanOrEqual(1.25);
    expect(contrast(LIGHT.cockpitRaised, LIGHT.cockpit)).toBeGreaterThanOrEqual(1.1);
  });

  it('keeps the route visible over primary light-map fills before casing', () => {
    const fills = [
      mapColor('background', 'background-color'),
      mapColor('water', 'fill-color'),
      mapColor('park', 'fill-color'),
    ];
    for (const fill of fills) expect(contrast(LIGHT.route, fill)).toBeGreaterThanOrEqual(3);
  });
});
