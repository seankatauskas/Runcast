import { authTokensSchema, type AuthTokens } from '@runcast/contracts';

export function createSerializedSessionWriter(
  write: (session: AuthTokens | null) => Promise<void>,
): (session: AuthTokens | null) => Promise<void> {
  let pending = Promise.resolve();
  return (session) => {
    const current = pending.then(() => write(session));
    pending = current.catch(() => undefined);
    return current;
  };
}

export function parseStoredSession(raw: string | null): AuthTokens | null {
  if (!raw) return null;
  try {
    const parsed = authTokensSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function removeLegacySession(
  raw: string | null,
  remove: () => Promise<void>,
  wipeUser: (userId: string) => Promise<void>,
): Promise<void> {
  if (!raw) return;
  const session = parseStoredSession(raw);
  await remove();
  if (session) await wipeUser(session.user.id);
}
