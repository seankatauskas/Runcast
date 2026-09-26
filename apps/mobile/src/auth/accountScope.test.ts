import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '@runcast/contracts';
import { ApiClient } from '../data/api';
import { createAccountScope } from './accountScope';

function tokens(userId: string, marker: string): AuthTokens {
  return {
    accessToken: `${marker}-access`,
    accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
    refreshToken: marker.repeat(32),
    refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
    user: { id: userId, displayName: null, email: null },
    isNewUser: false,
  };
}

describe('account-scoped asynchronous work', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('becomes inert after an account transition', async () => {
    const first = tokens('00000000-0000-4000-8000-000000000001', 'a');
    const second = tokens('00000000-0000-4000-8000-000000000002', 'b');
    let current: AuthTokens | null = first;
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('https://api.example', 'device', async () => {});
    client.setSession(first);
    const scope = createAccountScope(first, client, () => current);

    current = second;
    client.setSession(second);

    expect(scope.isCurrent()).toBe(false);
    expect(() => scope.assertCurrent()).toThrow(
      expect.objectContaining({ code: 'SESSION_CHANGED' }),
    );
    await expect(scope.api.request('/v1/routes')).rejects.toMatchObject({
      code: 'SESSION_CHANGED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
