import { describe, expect, it, vi } from 'vitest';
import type { AccountScope } from '../auth/accountScope';
import { ApiClientError } from './api';
import { createPreferenceEditWriter, synchronizePreferences } from './preferenceSync';
const values = {
  units: 'metric',
  temperatureUnit: 'celsius',
  theme: 'dark',
  defaultSpeed: 3.2,
  acceptableStartMinutes: 300,
  acceptableEndMinutes: 1320,
} as const;
const saved = { ...values, version: 8, updatedAt: '2026-09-19T00:00:00.000Z' };
const scope = (request: ReturnType<typeof vi.fn>, assertCurrent = vi.fn()) =>
  ({ api: { request }, assertCurrent }) as unknown as AccountScope;
describe('shared preference synchronization', () => {
  it('preserves the known edit version without a preflight GET', async () => {
    const request = vi.fn().mockResolvedValue(saved);
    expect(
      await synchronizePreferences(scope(request), { values, version: 7, editId: 'a' }),
    ).toEqual({ status: 'saved', preferences: saved, requestedVersion: 7 });
    expect(request).toHaveBeenCalledExactlyOnceWith('/v1/me/preferences', {
      method: 'PUT',
      body: JSON.stringify({ ...values, version: 7 }),
    });
  });
  it('fetches a version only for an unversioned edit', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...saved, version: 7 })
      .mockResolvedValueOnce(saved);
    await synchronizePreferences(scope(request), { values, version: null, editId: 'a' });
    expect(request).toHaveBeenNthCalledWith(1, '/v1/me/preferences');
    expect(request).toHaveBeenNthCalledWith(2, '/v1/me/preferences', {
      method: 'PUT',
      body: JSON.stringify({ ...values, version: 7 }),
    });
  });
  it.each([saved, {}])(
    'resolves version conflicts using valid details or a fresh GET',
    async (details) => {
      const request = vi
        .fn()
        .mockRejectedValueOnce(new ApiClientError(409, 'VERSION_CONFLICT', 'changed', details))
        .mockResolvedValue(saved);
      expect(
        await synchronizePreferences(scope(request), { values, version: 7, editId: 'a' }),
      ).toEqual({ status: 'conflict', preferences: saved, requestedVersion: 7 });
      expect(request).toHaveBeenCalledTimes(details === saved ? 1 : 2);
    },
  );
  it('propagates offline and session-change failures instead of treating them as conflicts', async () => {
    for (const error of [
      new Error('offline'),
      new ApiClientError(409, 'SESSION_CHANGED', 'changed'),
    ]) {
      const request = vi.fn().mockRejectedValue(error);
      await expect(
        synchronizePreferences(scope(request), { values, version: 7, editId: 'a' }),
      ).rejects.toBe(error);
      expect(request).toHaveBeenCalledOnce();
    }
  });
  it('preserves edit invocation order when the first preparation is slower', async () => {
    let release!: () => void;
    const prepare = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const persisted: string[] = [];
    const write = createPreferenceEditWriter(async (_scope, values) => {
      await prepare();
      persisted.push(values.theme);
      return { values, version: 7, editId: values.theme };
    });
    const active = scope(vi.fn());
    const first = write(active, values);
    const second = write(active, { ...values, theme: 'light' });
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
    expect(persisted).toEqual(['dark', 'light']);
  });
});
