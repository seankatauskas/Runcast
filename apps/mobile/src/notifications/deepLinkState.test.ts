import { describe, expect, it } from 'vitest';
import { missingRouteTerminal, validDeepLinkStart } from './deepLinkState';

describe('route deep-link terminal state', () => {
  it('separates missing, deleted, offline, and signed-out outcomes', () => {
    expect(
      missingRouteTerminal({ authenticated: false, syncOffline: false, wasKnown: false }),
    ).toBe('signed-out');
    expect(missingRouteTerminal({ authenticated: true, syncOffline: true, wasKnown: true })).toBe(
      'offline',
    );
    expect(missingRouteTerminal({ authenticated: true, syncOffline: false, wasKnown: true })).toBe(
      'deleted',
    );
    expect(missingRouteTerminal({ authenticated: true, syncOffline: false, wasKnown: false })).toBe(
      'missing',
    );
  });

  it('accepts only a finite millisecond start timestamp', () => {
    expect(validDeepLinkStart('1786881600000')).toBe(1_786_881_600_000);
    expect(validDeepLinkStart('1e12')).toBeNull();
    expect(validDeepLinkStart('tomorrow')).toBeNull();
  });
});
