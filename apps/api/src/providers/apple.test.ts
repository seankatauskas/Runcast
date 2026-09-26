import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  appleCodeExchangeTokens,
  appleIdentityFromPayload,
  destructiveAppleServerEvent,
} from './apple';

describe('Apple identity claims', () => {
  const rawNonce = 'apple-raw-nonce-1234';
  const hashedNonce = createHash('sha256').update(rawNonce).digest('hex');

  it('requires the SHA-256 nonce instead of accepting the raw nonce claim', () => {
    expect(
      appleIdentityFromPayload({ sub: 'apple-subject', nonce: hashedNonce }, rawNonce),
    ).toEqual({ subject: 'apple-subject', email: null });
    expect(() =>
      appleIdentityFromPayload({ sub: 'apple-subject', nonce: rawNonce }, rawNonce),
    ).toThrowError(expect.objectContaining({ code: 'APPLE_NONCE_MISMATCH' }));
  });

  it('requires both the refresh token and id_token from the code exchange', () => {
    expect(
      appleCodeExchangeTokens(
        { refresh_token: 'refresh', id_token: 'identity' },
        { ok: true, status: 200 },
      ),
    ).toEqual({ refreshToken: 'refresh', idToken: 'identity' });
    expect(() =>
      appleCodeExchangeTokens({ refresh_token: 'refresh' }, { ok: true, status: 200 }),
    ).toThrowError(expect.objectContaining({ code: 'APPLE_UNAVAILABLE' }));
  });
});

describe('Apple server events', () => {
  it.each(['consent-revoked', 'account-deleted'] as const)(
    'recognizes the destructive %s event',
    (type) => {
      expect(destructiveAppleServerEvent({ events: { type, sub: 'apple-subject' } })).toEqual({
        type,
        subject: 'apple-subject',
      });
    },
  );

  it('ignores other event types and malformed event claims', () => {
    expect(
      destructiveAppleServerEvent({ events: { type: 'email-disabled', sub: 'apple-subject' } }),
    ).toBeNull();
    expect(destructiveAppleServerEvent({ events: '{not-json' })).toBeNull();
    expect(
      destructiveAppleServerEvent({ type: 'consent-revoked', sub: 'apple-subject' }),
    ).toBeNull();
  });
});
