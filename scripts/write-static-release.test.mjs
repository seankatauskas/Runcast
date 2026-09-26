import { describe, expect, it } from 'vitest';
import { staticReleaseIdentity } from './write-static-release.mjs';

describe('static legal release identity', () => {
  it('prefers the Render deploy commit', () => {
    expect(
      staticReleaseIdentity({
        RENDER_GIT_COMMIT: 'render-sha',
        GITHUB_SHA: 'github-sha',
        RELEASE_SHA: 'manual-sha',
      }),
    ).toEqual({ service: 'runcast-legal', sha: 'render-sha' });
  });

  it('supports CI and local fallbacks', () => {
    expect(staticReleaseIdentity({ GITHUB_SHA: 'github-sha' }).sha).toBe('github-sha');
    expect(staticReleaseIdentity({ RELEASE_SHA: 'manual-sha' }).sha).toBe('manual-sha');
    expect(staticReleaseIdentity({}).sha).toBe('development');
  });
});
