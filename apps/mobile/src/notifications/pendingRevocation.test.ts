import type { AuthTokens } from '@runcast/contracts';
import { describe, expect, it, vi } from 'vitest';
import { deactivateDeviceBeforeSignOut, parsePendingDeviceRevocation } from './pendingRevocation';

const session: AuthTokens = {
  accessToken: 'access',
  accessTokenExpiresAt: '2026-08-15T13:00:00.000Z',
  refreshToken: 'r'.repeat(32),
  refreshTokenExpiresAt: '2026-09-15T12:00:00.000Z',
  user: {
    id: '018f9f9a-7b5e-7000-8000-000000000001',
    displayName: 'Runner',
    email: null,
  },
  isNewUser: false,
};

describe('pending device revocation', () => {
  it('clears an old pending record after successful pre-signout deactivation', async () => {
    const persist = vi.fn();
    const clear = vi.fn();
    await expect(
      deactivateDeviceBeforeSignOut({
        session,
        deviceId: 'device-12345',
        deactivate: vi.fn().mockResolvedValue(undefined),
        persist,
        clear,
      }),
    ).resolves.toBe('deactivated');
    expect(persist).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('persists the encrypted-store payload when deactivation is offline', async () => {
    let raw: string | null = null;
    await expect(
      deactivateDeviceBeforeSignOut({
        session,
        deviceId: 'device-12345',
        deactivate: vi.fn().mockRejectedValue(new TypeError('offline')),
        persist: async (pending) => {
          raw = JSON.stringify(pending);
        },
        clear: vi.fn(),
        now: new Date('2026-08-15T12:00:00.000Z'),
      }),
    ).resolves.toBe('pending');
    expect(parsePendingDeviceRevocation(raw)).toMatchObject({
      deviceId: 'device-12345',
      allDevices: false,
      createdAt: '2026-08-15T12:00:00.000Z',
      session,
    });
  });
});
