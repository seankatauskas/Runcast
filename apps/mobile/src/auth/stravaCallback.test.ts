import { describe, expect, it } from 'vitest';
import { parseStravaCallbackUrl, stravaCallbackError } from './stravaCallback';

describe('Strava callback handling', () => {
  it('accepts only one-time codes on the expected callback route', () => {
    const code = 'x'.repeat(43);
    expect(parseStravaCallbackUrl(`runcast://auth/strava?code=${code}`)).toEqual({
      type: 'code',
      code,
    });
    expect(() => parseStravaCallbackUrl(`https://example.com/?code=${code}`)).toThrow();
    expect(() => parseStravaCallbackUrl('runcast://auth/strava?code=short')).toThrow();
  });

  it('maps cancellation, linking, and collision results', () => {
    expect(parseStravaCallbackUrl('runcast://auth/strava?strava=denied')).toEqual({
      type: 'cancelled',
    });
    expect(parseStravaCallbackUrl('runcast://strava-routes?strava=connected')).toEqual({
      type: 'connected',
    });
    const collision = parseStravaCallbackUrl('runcast://auth/strava?error=IDENTITY_ALREADY_LINKED');
    expect(collision).toEqual({ type: 'error', code: 'IDENTITY_ALREADY_LINKED' });
    if (collision.type === 'error') {
      expect(stravaCallbackError(collision).message).toContain('another Runcast account');
    }
  });
});
