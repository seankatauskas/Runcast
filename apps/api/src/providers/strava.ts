import { fetchWithDeadline, GPX_MAX_UTF8_BYTES } from '@runcast/core';
import { assertProviderConfiguration, config } from '../config';
import { providerError } from '../errors';

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  athleteId: string;
  athleteDisplayName: string | null;
}

async function tokenRequest(
  params: Record<string, string>,
  requireAthlete: boolean,
): Promise<StravaTokens> {
  assertProviderConfiguration('strava');
  const response = await fetchWithDeadline('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.strava.clientId,
      client_secret: config.strava.clientSecret,
      ...params,
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    athlete?: { id?: number; firstname?: string; lastname?: string };
  };
  if (
    !response.ok ||
    !body.access_token ||
    !body.refresh_token ||
    !body.expires_at ||
    (requireAthlete && !body.athlete?.id)
  ) {
    throw providerError('strava', response.status);
  }
  const displayName = [body.athlete?.firstname, body.athlete?.lastname]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ')
    .trim();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(body.expires_at * 1000),
    athleteId: body.athlete?.id?.toString() ?? '',
    athleteDisplayName: displayName || null,
  };
}

export function stravaAuthorizationUrl(state: string): string {
  assertProviderConfiguration('strava');
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.strava.clientId,
    redirect_uri: config.strava.callbackUrl,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,read_all',
    state,
  }).toString();
  return url.toString();
}

export const exchangeStravaCode = (code: string) =>
  tokenRequest({ code, grant_type: 'authorization_code' }, true);
export const refreshStravaToken = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }, false);

export async function revokeStravaToken(accessToken: string): Promise<void> {
  const response = await fetchWithDeadline('https://www.strava.com/oauth/deauthorize', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw providerError('strava', response.status);
}

export async function listStravaRoutes(
  accessToken: string,
): Promise<Array<{ id: string; name: string; distance: number; private: boolean }>> {
  const response = await fetchWithDeadline(
    'https://www.strava.com/api/v3/athlete/routes?per_page=100',
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw providerError('strava', response.status);
  const body = (await response.json()) as Array<{
    id_str?: string;
    id?: number;
    name?: string;
    distance?: number;
    private?: boolean;
    type?: number;
  }>;
  return body
    .filter((route) => route.type === 2 || route.type === undefined)
    .map((route) => ({
      id: route.id_str ?? String(route.id),
      name: route.name ?? 'Strava route',
      distance: route.distance ?? 0,
      private: route.private ?? false,
    }));
}

export async function exportStravaRoute(accessToken: string, routeId: string): Promise<string> {
  const response = await fetchWithDeadline(
    `https://www.strava.com/api/v3/routes/${encodeURIComponent(routeId)}/export_gpx`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw providerError('strava', response.status);
  return readBoundedGpxResponse(response);
}

export class StravaGpxLimitError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE';

  constructor() {
    super('Strava GPX export exceeds the 2 MiB UTF-8 limit');
    this.name = 'StravaGpxLimitError';
  }
}

/** Enforce the import bound while streaming, even without Content-Length. */
export async function readBoundedGpxResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > GPX_MAX_UTF8_BYTES) {
    throw new StravaGpxLimitError();
  }
  if (!response.body) throw new Error('Strava GPX response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > GPX_MAX_UTF8_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new StravaGpxLimitError();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}
