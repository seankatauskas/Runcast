import { authTokensSchema, type AuthTokens } from '@runcast/contracts';

export interface PendingDeviceRevocation {
  session: AuthTokens;
  deviceId: string;
  allDevices: boolean;
  createdAt: string;
}

export function pendingDeviceRevocation(
  session: AuthTokens,
  deviceId: string,
  allDevices = false,
  now = new Date(),
): PendingDeviceRevocation {
  return { session, deviceId, allDevices, createdAt: now.toISOString() };
}

export function parsePendingDeviceRevocation(raw: string | null): PendingDeviceRevocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const session = authTokensSchema.safeParse(parsed.session);
    if (
      !session.success ||
      typeof parsed.deviceId !== 'string' ||
      parsed.deviceId.length < 8 ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      return null;
    }
    return {
      session: session.data,
      deviceId: parsed.deviceId,
      allDevices: parsed.allDevices === true,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export async function deactivateDeviceBeforeSignOut(input: {
  session: AuthTokens;
  deviceId: string;
  deactivate: () => Promise<void>;
  persist: (pending: PendingDeviceRevocation) => Promise<void>;
  clear: () => Promise<void>;
  allDevices?: boolean;
  now?: Date;
}): Promise<'deactivated' | 'pending'> {
  try {
    await input.deactivate();
    await input.clear();
    return 'deactivated';
  } catch {
    await input.persist(
      pendingDeviceRevocation(input.session, input.deviceId, input.allDevices, input.now),
    );
    return 'pending';
  }
}
