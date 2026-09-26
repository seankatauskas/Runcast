import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config';
import { AppError } from '../errors';

const key = new TextEncoder().encode(config.accessTokenSecret);
const issuer = 'https://api.runcast.app';
const audience = 'runcast-mobile';

export interface AccessClaims {
  userId: string;
  deviceId: string;
  sessionId: string;
}

export async function signAccessToken(
  claims: AccessClaims,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const token = await new SignJWT({
    deviceId: claims.deviceId,
    sessionId: claims.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key);
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer,
      audience,
      algorithms: ['HS256'],
    });
    if (
      !payload.sub ||
      typeof payload.deviceId !== 'string' ||
      typeof payload.sessionId !== 'string'
    ) {
      throw new Error('missing claims');
    }
    return {
      userId: payload.sub,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
    };
  } catch {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid or expired');
  }
}
