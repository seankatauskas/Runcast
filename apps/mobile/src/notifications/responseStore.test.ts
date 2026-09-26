import type { NotificationPayload } from '@runcast/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  failNextWrite: false,
  getItem: vi.fn(async (key: string) => storage.values.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    if (storage.failNextWrite) {
      storage.failNextWrite = false;
      throw new TypeError('disk unavailable');
    }
    storage.values.set(key, value);
  }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: storage.getItem, setItem: storage.setItem },
}));

import {
  completeNotificationResponse,
  pendingNotificationResponses,
  queueNotificationResponse,
} from './responseStore';

const payload: NotificationPayload = {
  schemaVersion: 1,
  type: 'watch-recommendation',
  route: { id: '018f9f9a-7b5e-7000-8000-000000000001', name: 'Lake Loop' },
  watch: {
    id: '018f9f9a-7b5e-7000-8000-000000000002',
    occurrenceDate: '2026-08-16',
  },
  delivery: { id: '018f9f9a-7b5e-7000-8000-000000000003' },
  snapshot: {
    engine: 'planning-v2',
    id: '018f9f9a-7b5e-7000-8000-000000000004',
    status: 'recommended',
  },
  start: '2026-08-16T12:00:00.000Z',
  url: 'runcast://routes/018f9f9a-7b5e-7000-8000-000000000001?start=1786881600000&evaluation=018f9f9a-7b5e-7000-8000-000000000004',
};

describe('notification response store', () => {
  beforeEach(() => {
    storage.values.clear();
    storage.failNextWrite = false;
    vi.clearAllMocks();
  });

  it('surfaces one failed write without poisoning later serialized updates', async () => {
    storage.failNextWrite = true;
    await expect(queueNotificationResponse(payload)).rejects.toThrow('disk unavailable');
    await expect(queueNotificationResponse(payload)).resolves.toBe(true);
    expect(await pendingNotificationResponses()).toEqual([payload]);
    await expect(completeNotificationResponse(payload.delivery.id)).resolves.toBeUndefined();
    expect(await pendingNotificationResponses()).toEqual([]);
  });
});
