import { describe, expect, it } from 'vitest';
import { legalNavigation, legalPageForPath } from './legalPages';

describe('legalPageForPath', () => {
  it('resolves every published legal route with or without a trailing slash', () => {
    for (const page of legalNavigation) {
      expect(legalPageForPath(page.path)).toBe(page);
      expect(legalPageForPath(`${page.path}/`)).toBe(page);
    }
  });

  it('leaves the planner and unknown routes to the app shell', () => {
    expect(legalPageForPath('/')).toBeNull();
    expect(legalPageForPath('/not-published')).toBeNull();
  });
});
