import { describe, expect, it } from 'vitest';
import {
  initialNotificationReadiness,
  notificationReadinessPresentation,
  permissionState,
  readinessFromDeviceStatus,
  shouldOfferNotificationSetup,
  shouldUpsertCurrentNotificationToken,
} from './readiness';

describe('notification readiness', () => {
  it('does not equate OS permission with server readiness', () => {
    const allowed = {
      ...initialNotificationReadiness,
      permission: 'granted' as const,
      project: 'configured' as const,
      token: 'available' as const,
      registration: 'unregistered' as const,
    };
    expect(shouldOfferNotificationSetup(allowed)).toBe(true);
    expect(notificationReadinessPresentation(allowed).title).toBe('Device is not registered');
  });

  it('treats iOS provisional authorization as granted and denial as denied', () => {
    expect(
      permissionState({
        platform: 'ios',
        granted: true,
        iosStatus: 3,
        iosNotDetermined: 0,
        iosDenied: 1,
      }),
    ).toBe('granted');
    expect(
      permissionState({
        platform: 'ios',
        granted: false,
        iosStatus: 1,
        iosNotDetermined: 0,
        iosDenied: 1,
      }),
    ).toBe('denied');
  });

  it('preserves the no-watch server state while marking the installation registered', () => {
    const result = readinessFromDeviceStatus(
      {
        ...initialNotificationReadiness,
        permission: 'granted',
        project: 'configured',
        token: 'available',
      },
      {
        state: 'no-enabled-watches',
        enabledWatchCount: 0,
        installation: {
          platform: 'ios',
          appVersion: '0.2.0',
          enabled: true,
          lastSeenAt: '2026-08-15T12:00:00.000Z',
        },
      },
    );
    expect(result.registration).toBe('registered');
    expect(result.serverState).toBe('no-enabled-watches');
    expect(notificationReadinessPresentation(result).remediation).toBe('manage-watches');
  });

  it('repairs killed-app token rotations only when refresh can safely upsert', () => {
    expect(
      shouldUpsertCurrentNotificationToken({
        authenticated: true,
        permission: 'granted',
        project: 'configured',
        token: 'available',
      }),
    ).toBe(true);
    expect(
      shouldUpsertCurrentNotificationToken({
        authenticated: true,
        permission: 'not-determined',
        project: 'configured',
        token: 'unknown',
      }),
    ).toBe(false);
  });
});
