import { createHash } from 'node:crypto';
import { fetchWithDeadline } from '@runcast/core';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { assertProviderConfiguration, config } from '../config';
import { AppError, providerError } from '../errors';

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'), {
  timeoutDuration: 15_000,
});

export interface AppleIdentity {
  subject: string;
  email: string | null;
}

export type DestructiveAppleServerEventType = 'consent-revoked' | 'account-deleted';

export interface DestructiveAppleServerEvent {
  type: DestructiveAppleServerEventType;
  subject: string;
}

export function appleCodeExchangeTokens(
  body: unknown,
  response: { ok: boolean; status: number },
): { refreshToken: string; idToken: string } {
  const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (
    !response.ok ||
    typeof fields.refresh_token !== 'string' ||
    !fields.refresh_token ||
    typeof fields.id_token !== 'string' ||
    !fields.id_token
  ) {
    throw providerError('apple', response.status);
  }
  return { refreshToken: fields.refresh_token, idToken: fields.id_token };
}

export function appleIdentityFromPayload(payload: JWTPayload, rawNonce: string): AppleIdentity {
  const nonceHash = createHash('sha256').update(rawNonce).digest('hex');
  if (payload.nonce !== nonceHash) {
    throw new AppError(401, 'APPLE_NONCE_MISMATCH', 'Apple sign-in nonce did not match');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new AppError(401, 'INVALID_APPLE_TOKEN', 'Apple identity token has no subject');
  }
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
  };
}

export function destructiveAppleServerEvent(
  payload: JWTPayload,
): DestructiveAppleServerEvent | null {
  let eventClaims: Record<string, unknown> | null = null;
  if (payload.events && typeof payload.events === 'object') {
    eventClaims = payload.events as Record<string, unknown>;
  } else if (typeof payload.events === 'string') {
    try {
      const parsed = JSON.parse(payload.events) as unknown;
      if (parsed && typeof parsed === 'object') eventClaims = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!eventClaims) return null;
  const type = eventClaims.type;
  if (type !== 'consent-revoked' && type !== 'account-deleted') return null;
  const subject = eventClaims.sub;
  return typeof subject === 'string' && subject ? { type, subject } : null;
}

export async function verifyAppleIdentity(
  identityToken: string,
  rawNonce: string,
): Promise<AppleIdentity> {
  try {
    const { payload } = await jwtVerify(identityToken, appleKeys, {
      issuer: 'https://appleid.apple.com',
      audience: config.apple.clientId,
      algorithms: ['RS256'],
    });
    return appleIdentityFromPayload(payload, rawNonce);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'INVALID_APPLE_TOKEN', 'Apple identity token is invalid or expired');
  }
}

async function appleClientSecret(): Promise<string> {
  assertProviderConfiguration('apple');
  const key = await importPKCS8(config.apple.privateKey, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.apple.keyId })
    .setIssuer(config.apple.teamId)
    .setSubject(config.apple.clientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

export async function exchangeAppleCode(
  code: string,
): Promise<{ refreshToken: string; idToken: string }> {
  const response = await fetchWithDeadline('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.apple.clientId,
      client_secret: await appleClientSecret(),
      code,
      grant_type: 'authorization_code',
    }),
  });
  return appleCodeExchangeTokens(await response.json(), response);
}

export async function revokeAppleToken(refreshToken: string): Promise<void> {
  const response = await fetchWithDeadline('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.apple.clientId,
      client_secret: await appleClientSecret(),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
  });
  if (!response.ok) throw providerError('apple', response.status);
}

export async function verifyAppleServerNotification(signedPayload: string): Promise<JWTPayload> {
  try {
    return (
      await jwtVerify(signedPayload, appleKeys, {
        issuer: 'https://appleid.apple.com',
        audience: config.apple.clientId,
        algorithms: ['RS256'],
      })
    ).payload;
  } catch {
    throw new AppError(401, 'INVALID_APPLE_WEBHOOK', 'Apple server notification is invalid');
  }
}
