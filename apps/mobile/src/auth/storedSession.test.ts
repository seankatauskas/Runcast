import { describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '@runcast/contracts';
import { createSerializedSessionWriter, removeLegacySession } from './storedSession';

const legacySession = {
  accessToken: 'access',
  accessTokenExpiresAt: '2026-07-18T12:00:00.000Z',
  refreshToken: 'r'.repeat(32),
  refreshTokenExpiresAt: '2026-08-18T12:00:00.000Z',
  user: {
    id: '2f272b14-601d-4be1-a219-e63967069aac',
    displayName: null,
    email: null,
  },
  isNewUser: false,
};

describe('session storage migration', () => {
  it('removes the Apple-only v1 session and wipes its user-scoped cache', async () => {
    const remove = vi.fn(async () => {});
    const wipe = vi.fn(async () => {});
    await removeLegacySession(JSON.stringify(legacySession), remove, wipe);
    expect(remove).toHaveBeenCalledOnce();
    expect(wipe).toHaveBeenCalledWith(legacySession.user.id);
  });

  it('removes malformed legacy storage without guessing a cache owner', async () => {
    const remove = vi.fn(async () => {});
    const wipe = vi.fn(async () => {});
    await removeLegacySession('{invalid', remove, wipe);
    expect(remove).toHaveBeenCalledOnce();
    expect(wipe).not.toHaveBeenCalled();
  });
});

describe('session persistence ordering', () => {
  it('finishes session writes in the order they were requested', async () => {
    let finishFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const writes: Array<string | null> = [];
    const write = vi.fn(async (session: AuthTokens | null) => {
      writes.push(session?.accessToken ?? null);
      if (session?.accessToken === 'first') await firstPending;
    });
    const serialized = createSerializedSessionWriter(write);

    const first = serialized({ ...legacySession, accessToken: 'first' });
    const second = serialized({ ...legacySession, accessToken: 'second' });
    await Promise.resolve();
    expect(writes).toEqual(['first']);

    finishFirst();
    await Promise.all([first, second]);
    expect(writes).toEqual(['first', 'second']);
  });
});
