import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestDeadlineExceededError } from '@runcast/core';
import { ApiClient, ApiClientError, ApiTransportError } from './api';

const errorBody = (code: string, message: string) =>
  JSON.stringify({ error: { code, message, requestId: 'request-1' } });

describe('planning bundle API transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends reader/build/ETag compatibility headers and returns raw 200 data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"bundle":true}', {
        status: 200,
        headers: { etag: '"new"', 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('https://api.example', 'device', async () => {});
    await expect(
      client.requestPlanningBundle('route / 1', 'mobile-build', '"old"'),
    ).resolves.toEqual({ status: 'modified', body: '{"bundle":true}', etag: '"new"' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v2/routes/route%20%2F%201/planning-bundle',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Runcast-Bundle-Reader': '3',
          'X-Runcast-Evaluator-Build': 'mobile-build',
          'If-None-Match': '"old"',
          'x-request-id': expect.stringMatching(/^mobile-/),
        }),
      }),
    );
  });

  it.each([
    [304, {}, { status: 'not-modified', etag: null }],
    [202, { 'retry-after': '8' }, { status: 'preparing', retryAfterSeconds: 8 }],
    [
      404,
      { 'content-type': 'application/json' },
      { status: 'unavailable', reason: 'Planning rollout disabled Reference: request-1' },
    ],
    [
      426,
      { 'content-type': 'application/json' },
      { status: 'update-required', reason: 'Upgrade Reference: request-1' },
    ],
    [
      503,
      { 'content-type': 'application/json' },
      { status: 'unavailable', reason: 'Forecast down Reference: request-1' },
    ],
  ])(
    'maps HTTP %s without treating it as a generic request failure',
    async (status, headers, expected) => {
      const body =
        status === 404
          ? errorBody('ROUTE_NOT_FOUND', 'Planning rollout disabled')
          : status === 426
            ? errorBody('CLIENT_UPDATE_REQUIRED', 'Upgrade')
            : status === 503
              ? errorBody('FORECAST_UNAVAILABLE', 'Forecast down')
              : null;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status, headers })));
      const client = new ApiClient('https://api.example', 'device', async () => {});
      await expect(client.requestPlanningBundle('route-1', 'mobile-build')).resolves.toEqual(
        expected,
      );
    },
  );

  it('provides a user-safe request reference for network and timeout failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new RequestDeadlineExceededError(15_000)));
    const client = new ApiClient('https://api.example', 'device', async () => {});
    const error = await client.request('/v1/routes').catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiTransportError);
    if (!(error instanceof ApiTransportError)) throw error;
    expect(error).toMatchObject({ kind: 'timeout', requestId: expect.stringMatching(/^mobile-/) });
    expect(error.message).toContain(`Reference: ${error.requestId}`);
  });

  it.each([503, 504])('retains a session when refresh receives HTTP %s', async (status) => {
    const sessionChanges = vi.fn(async () => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(errorBody('REFRESH_UNAVAILABLE', 'Try again later'), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = new ApiClient('https://api.example', 'device', sessionChanges);
    client.setSession({
      accessToken: 'access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'r'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    });
    await expect(client.refresh()).rejects.toBeInstanceOf(ApiClientError);
    expect(sessionChanges).not.toHaveBeenCalledWith(null);
  });

  it('retains a session when refresh cannot reach the API', async () => {
    const sessionChanges = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    const client = new ApiClient('https://api.example', 'device', sessionChanges);
    client.setSession({
      accessToken: 'access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'r'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    });
    await expect(client.refresh()).rejects.toMatchObject({ kind: 'network' });
    expect(sessionChanges).not.toHaveBeenCalledWith(null);
  });

  it('clears a session only when the server confirms the refresh token is invalid', async () => {
    const sessionChanges = vi.fn(async () => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(errorBody('INVALID_REFRESH_TOKEN', 'Session expired'), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = new ApiClient('https://api.example', 'device', sessionChanges);
    client.setSession({
      accessToken: 'access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'r'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    });
    await expect(client.refresh()).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(sessionChanges).toHaveBeenCalledWith(null);
  });

  it('does not automatically replay mutations after refreshing a 401', async () => {
    const refreshed = {
      accessToken: 'next-access',
      accessTokenExpiresAt: '2026-08-15T13:00:00.000Z',
      refreshToken: 'n'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T13:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(errorBody('INVALID_ACCESS_TOKEN', 'Expired'), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refreshed), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('https://api.example', 'device', async () => {});
    client.setSession({ ...refreshed, accessToken: 'old-access' });
    await expect(
      client.request('/v1/watches', { method: 'POST', body: JSON.stringify({ enabled: true }) }),
    ).rejects.toMatchObject({ code: 'SESSION_REFRESHED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale refresh replace a newer account session', async () => {
    let completeRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      completeRefresh = resolve;
    });
    const sessionChanges = vi.fn(async () => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => refreshResponse),
    );
    const client = new ApiClient('https://api.example', 'device', sessionChanges);
    const first = {
      accessToken: 'first-access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'a'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    };
    const second = {
      ...first,
      accessToken: 'second-access',
      refreshToken: 'b'.repeat(32),
      user: { ...first.user, id: '00000000-0000-4000-8000-000000000002' },
    };
    const refreshedFirst = {
      ...first,
      accessToken: 'refreshed-first-access',
      refreshToken: 'c'.repeat(32),
    };
    client.setSession(first);
    const staleRefresh = client.refresh();
    client.setSession(second);
    completeRefresh(
      new Response(JSON.stringify(refreshedFirst), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(staleRefresh).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(sessionChanges).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await client.request('/v1/me');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://api.example/v1/me',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer second-access' }),
      }),
    );
  });

  it('invalidates account-bound clients when the active account changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('https://api.example', 'device', async () => {});
    const first = {
      accessToken: 'first-access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'a'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    };
    client.setSession(first);
    const bound = client.bindSession(first.user.id);
    client.setSession({
      ...first,
      accessToken: 'second-access',
      refreshToken: 'b'.repeat(32),
      user: { ...first.user, id: '00000000-0000-4000-8000-000000000002' },
    });

    expect(bound.isCurrent()).toBe(false);
    await expect(bound.request('/v1/routes')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards an in-flight response after an account transition', async () => {
    let completeRequest!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      completeRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pendingResponse),
    );
    const client = new ApiClient('https://api.example', 'device', async () => {});
    const first = {
      accessToken: 'first-access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'a'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    };
    client.setSession(first);
    const scope = client.bindSession(first.user.id);
    const inFlight = scope.request('/v1/routes');
    client.setSession({
      ...first,
      accessToken: 'second-access',
      refreshToken: 'b'.repeat(32),
      user: { ...first.user, id: '00000000-0000-4000-8000-000000000002' },
    });
    completeRequest(new Response('{"routes":[]}', { status: 200 }));

    await expect(inFlight).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });

  it('does not revive bound work after an account changes away and back', async () => {
    let completeRequest!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      completeRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pendingResponse),
    );
    const client = new ApiClient('https://api.example', 'device', async () => {});
    const first = {
      accessToken: 'first-access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'a'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    };
    client.setSession(first);
    const scope = client.bindSession(first.user.id);
    const inFlight = scope.request('/v1/routes');
    client.setSession({
      ...first,
      accessToken: 'second-access',
      refreshToken: 'b'.repeat(32),
      user: { ...first.user, id: '00000000-0000-4000-8000-000000000002' },
    });
    client.setSession({ ...first, accessToken: 'returned-access', refreshToken: 'c'.repeat(32) });
    completeRequest(new Response('{"routes":[]}', { status: 200 }));

    await expect(inFlight).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(scope.isCurrent()).toBe(false);
  });

  it('discards a response when the account changes while its body is being read', async () => {
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    let completeBody!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => {
      completeBody = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => {
          bodyStarted();
          return body;
        },
      }),
    );
    const client = new ApiClient('https://api.example', 'device', async () => {});
    const first = {
      accessToken: 'first-access',
      accessTokenExpiresAt: '2026-08-15T12:00:00.000Z',
      refreshToken: 'a'.repeat(32),
      refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
      user: { id: '00000000-0000-4000-8000-000000000001', displayName: null, email: null },
      isNewUser: false,
    };
    client.setSession(first);
    const inFlight = client.bindSession(first.user.id).request('/v1/routes');
    await started;
    client.setSession({
      ...first,
      accessToken: 'second-access',
      refreshToken: 'b'.repeat(32),
      user: { ...first.user, id: '00000000-0000-4000-8000-000000000002' },
    });
    completeBody({ routes: [] });

    await expect(inFlight).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });
});
