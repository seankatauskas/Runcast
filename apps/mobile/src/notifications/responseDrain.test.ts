import type { NotificationPayload } from '@runcast/contracts';
import { describe, expect, it, vi } from 'vitest';
import { drainNotificationResponses, type NotificationDrainMemory } from './responseDrain';

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

function memory(): NotificationDrainMemory {
  return { processing: new Set(), navigated: new Set(), directedToAccount: new Set() };
}

describe('notification response drain', () => {
  it('consumes a foreground response received after the initial empty mount drain exactly once', async () => {
    const state = memory();
    const consume = vi.fn().mockResolvedValue('opened');
    const complete = vi.fn().mockResolvedValue(undefined);
    const common = {
      status: 'authenticated' as const,
      memory: state,
      navigateRoute: vi.fn(),
      navigateAccount: vi.fn(),
      consume,
      complete,
    };
    await drainNotificationResponses({ ...common, pending: [] });
    await Promise.all([
      drainNotificationResponses({ ...common, pending: [payload] }),
      drainNotificationResponses({ ...common, pending: [payload] }),
    ]);
    expect(consume).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(common.navigateRoute).toHaveBeenCalledOnce();
  });

  it('keeps a failed offline response pending for a later successful drain', async () => {
    const state = memory();
    const consume = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce('opened');
    const complete = vi.fn().mockResolvedValue(undefined);
    const common = {
      status: 'authenticated' as const,
      pending: [payload],
      memory: state,
      navigateRoute: vi.fn(),
      navigateAccount: vi.fn(),
      consume,
      complete,
    };
    await drainNotificationResponses(common);
    await drainNotificationResponses(common);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledOnce();
    expect(common.navigateRoute).toHaveBeenCalledOnce();
  });
});
