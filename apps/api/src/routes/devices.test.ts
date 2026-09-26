import { describe, expect, it } from 'vitest';
import { deviceStatusResponse } from './devices';

const installation = {
  platform: 'ios',
  appVersion: '2.0.0',
  enabled: true,
  lastSeenAt: new Date('2026-08-15T12:00:00.000Z'),
};

describe('device readiness response', () => {
  it('reports each finite server-side readiness state', () => {
    expect(deviceStatusResponse(null, 0).state).toBe('unregistered');
    expect(deviceStatusResponse({ ...installation, enabled: false }, 1).state).toBe('disabled');
    expect(deviceStatusResponse(installation, 0).state).toBe('no-enabled-watches');
    expect(deviceStatusResponse(installation, 1)).toEqual({
      state: 'ready',
      enabledWatchCount: 1,
      installation: {
        platform: 'ios',
        appVersion: '2.0.0',
        enabled: true,
        lastSeenAt: '2026-08-15T12:00:00.000Z',
      },
    });
  });
});
