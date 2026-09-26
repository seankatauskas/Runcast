import { describe, expect, it, vi } from 'vitest';
import { acknowledgeOwnedNotification } from './openOwnership';

describe('notification ownership acknowledgement', () => {
  it('caches the notification fallback before acknowledging the open', async () => {
    const order: string[] = [];
    await expect(
      acknowledgeOwnedNotification({
        acknowledge: async () => {
          order.push('ack');
        },
        cache: async () => {
          order.push('cache');
        },
        isNotFound: () => false,
      }),
    ).resolves.toBe('opened');
    expect(order).toEqual(['cache', 'ack']);
  });

  it('discards another account’s 404 delivery after retaining only its notification fallback', async () => {
    const cache = vi.fn();
    await expect(
      acknowledgeOwnedNotification({
        acknowledge: vi.fn().mockRejectedValue({ status: 404 }),
        cache,
        isNotFound: (error) =>
          typeof error === 'object' && error !== null && 'status' in error && error.status === 404,
      }),
    ).resolves.toBe('discarded');
    expect(cache).toHaveBeenCalledOnce();
  });
});
