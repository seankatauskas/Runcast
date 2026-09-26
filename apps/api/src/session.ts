import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db/client';
import { sessions } from './db/schema';
import { AppError } from './errors';
import { iso } from './http';
import { hashToken, opaqueToken } from './security/crypto';
import { signAccessToken } from './security/tokens';

const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60_000;

export async function createSession(
  userId: string,
  deviceId: string,
): Promise<{
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}> {
  const refreshToken = opaqueToken();
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_LIFETIME_MS);
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      deviceId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
    })
    .returning({ id: sessions.id });
  const access = await signAccessToken({
    userId,
    deviceId,
    sessionId: session.id,
  });
  return {
    sessionId: session.id,
    accessToken: access.token,
    accessTokenExpiresAt: iso(access.expiresAt),
    refreshToken,
    refreshTokenExpiresAt: iso(refreshTokenExpiresAt),
  };
}

export async function rotateSession(
  refreshToken: string,
  deviceId: string,
  testHooks: { beforeCompareAndSwap?: () => Promise<void> } = {},
): Promise<
  ReturnType<typeof createSession> extends Promise<infer T> ? T & { userId: string } : never
> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hashToken(refreshToken)))
      .limit(1);
    if (!current) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
    if (current.revokedAt) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, current.userId), isNull(sessions.revokedAt)));
      return { outcome: 'reuse' as const };
    }
    if (current.deviceId !== deviceId || current.expiresAt <= new Date()) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    }

    const nextToken = opaqueToken();
    const nextExpiry = new Date(Date.now() + REFRESH_LIFETIME_MS);
    const [next] = await tx
      .insert(sessions)
      .values({
        userId: current.userId,
        deviceId,
        refreshTokenHash: hashToken(nextToken),
        expiresAt: nextExpiry,
      })
      .returning({ id: sessions.id });
    await testHooks.beforeCompareAndSwap?.();
    const updated = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), rotatedToId: next.id })
      .where(and(eq(sessions.id, current.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!updated.length) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, current.userId), isNull(sessions.revokedAt)));
      return { outcome: 'reuse' as const };
    }
    const access = await signAccessToken({
      userId: current.userId,
      deviceId,
      sessionId: next.id,
    });
    return {
      outcome: 'rotated' as const,
      userId: current.userId,
      sessionId: next.id,
      accessToken: access.token,
      accessTokenExpiresAt: iso(access.expiresAt),
      refreshToken: nextToken,
      refreshTokenExpiresAt: iso(nextExpiry),
    };
  });
  if (result.outcome === 'reuse') {
    throw new AppError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Refresh token reuse was detected; all sessions were revoked',
    );
  }
  const { outcome: _outcome, ...tokens } = result;
  return tokens;
}
