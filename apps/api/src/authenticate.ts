import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db/client';
import { sessions } from './db/schema';
import { AppError } from './errors';
import { verifyAccessToken, type AccessClaims } from './security/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AccessClaims;
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer '))
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required');
  const claims = await verifyAccessToken(authorization.slice(7));
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, claims.sessionId),
        eq(sessions.userId, claims.userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) throw new AppError(401, 'SESSION_REVOKED', 'Session is no longer active');
  request.auth = claims;
}
