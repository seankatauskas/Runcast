import { describe, expect, it } from 'vitest';
import { routeMenuLayout } from './routeMenuLayout';

describe('routeMenuLayout', () => {
  it('leaves the lower planning dock unobstructed on a phone viewport', () => {
    const layout = routeMenuLayout({
      anchor: { x: 16, y: 59, width: 210, height: 48 },
      windowWidth: 390,
      windowHeight: 844,
      bottomInset: 34,
    });

    expect(layout).toMatchObject({ width: 304, left: 16, top: 115 });
    expect(layout.maxHeight).toBeCloseTo(388.24);
    expect(layout.top + layout.maxHeight).toBeLessThan(510);
  });

  it('opens above a low trigger instead of collapsing into an unusable strip', () => {
    const layout = routeMenuLayout({
      anchor: { x: 350, y: 500, width: 40, height: 48 },
      windowWidth: 390,
      windowHeight: 620,
      bottomInset: 20,
    });

    expect(layout.left).toBe(70);
    expect(layout.top).toBeCloseTo(206.8);
    expect(layout.maxHeight).toBeCloseTo(285.2);
    expect(layout.top + layout.maxHeight).toBe(492);
  });
});
