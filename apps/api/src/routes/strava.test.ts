import { describe, expect, it } from 'vitest';
import { validateMobileRedirectUri } from './strava';

describe('Strava mobile redirect validation', () => {
  it('accepts only the app scheme configured for the API environment', () => {
    expect(validateMobileRedirectUri('runcast-preview://auth/strava', 'runcast-preview:')).toBe(
      'runcast-preview://auth/strava',
    );
    expect(() => validateMobileRedirectUri('runcast://auth/strava', 'runcast-preview:')).toThrow(
      expect.objectContaining({ code: 'INVALID_REDIRECT_URI' }),
    );
  });

  it('continues to reject query parameters on an otherwise allowed callback', () => {
    expect(() =>
      validateMobileRedirectUri(
        'runcast-preview://auth/strava?forward=https://example.test',
        'runcast-preview:',
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REDIRECT_URI' }));
  });
});
