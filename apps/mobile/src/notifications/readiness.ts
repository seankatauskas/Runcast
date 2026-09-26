import type { DeviceStatus } from '@runcast/contracts';

export type NotificationPermissionState = 'checking' | 'not-determined' | 'denied' | 'granted';
export type NotificationProjectState = 'configured' | 'missing';
export type NotificationTokenState = 'unknown' | 'available' | 'unavailable';
export type NotificationRegistrationState =
  'checking' | 'registered' | 'unregistered' | 'disabled' | 'offline';

export interface NotificationReadiness {
  permission: NotificationPermissionState;
  project: NotificationProjectState;
  token: NotificationTokenState;
  registration: NotificationRegistrationState;
  serverState: DeviceStatus['state'] | null;
  enabledWatchCount: number;
}

export const initialNotificationReadiness: NotificationReadiness = {
  permission: 'checking',
  project: 'missing',
  token: 'unknown',
  registration: 'checking',
  serverState: null,
  enabledWatchCount: 0,
};

export function permissionState(input: {
  platform: string;
  granted: boolean;
  status?: string;
  iosStatus?: number | null;
  iosNotDetermined: number;
  iosDenied: number;
}): NotificationPermissionState {
  if (input.platform === 'ios') {
    if (input.iosStatus === input.iosNotDetermined) return 'not-determined';
    if (input.iosStatus === input.iosDenied) return 'denied';
  }
  if (input.status === 'undetermined') return 'not-determined';
  if (input.granted) return 'granted';
  return 'denied';
}

export function readinessFromDeviceStatus(
  current: NotificationReadiness,
  status: DeviceStatus,
): NotificationReadiness {
  return {
    ...current,
    registration:
      status.state === 'unregistered'
        ? 'unregistered'
        : status.state === 'disabled'
          ? 'disabled'
          : 'registered',
    serverState: status.state,
    enabledWatchCount: status.enabledWatchCount,
  };
}

export type NotificationRemediation = 'enable' | 'open-settings' | 'retry' | 'manage-watches';

export interface NotificationReadinessPresentation {
  title: string;
  detail: string;
  remediation: NotificationRemediation | null;
}

export function notificationReadinessPresentation(
  readiness: NotificationReadiness,
): NotificationReadinessPresentation {
  if (readiness.project === 'missing') {
    return {
      title: 'Route notifications unavailable',
      detail: 'This build is missing its EAS project configuration.',
      remediation: null,
    };
  }
  if (readiness.permission === 'checking' || readiness.registration === 'checking') {
    return {
      title: 'Checking route notifications',
      detail: 'Verifying device and server status…',
      remediation: null,
    };
  }
  if (readiness.permission === 'not-determined') {
    return {
      title: 'Route notifications are off',
      detail: 'Enable optional reminders for route-watch recommendations.',
      remediation: 'enable',
    };
  }
  if (readiness.permission === 'denied') {
    return {
      title: 'Route notifications are blocked',
      detail: 'Allow notifications for Runcast in device Settings.',
      remediation: 'open-settings',
    };
  }
  if (readiness.token === 'unavailable') {
    return {
      title: 'Push token unavailable',
      detail: 'Permission is allowed, but this device could not reach Expo. Try again online.',
      remediation: 'retry',
    };
  }
  if (readiness.registration === 'offline') {
    return {
      title: 'Registration could not be verified',
      detail: 'Runcast will retry when the app is online.',
      remediation: 'retry',
    };
  }
  if (readiness.registration === 'unregistered' || readiness.registration === 'disabled') {
    return {
      title: 'Device is not registered',
      detail: 'Permission is allowed. Finish setup to receive route-watch reminders.',
      remediation: 'enable',
    };
  }
  if (readiness.enabledWatchCount === 0) {
    return {
      title: 'Notifications are ready',
      detail: 'Create or enable a route watch to receive reminders.',
      remediation: 'manage-watches',
    };
  }
  return {
    title: 'Notifications are ready',
    detail: `${readiness.enabledWatchCount} enabled ${readiness.enabledWatchCount === 1 ? 'watch' : 'watches'} on this account.`,
    remediation: null,
  };
}

export function shouldOfferNotificationSetup(readiness: NotificationReadiness): boolean {
  return !(
    readiness.permission === 'granted' &&
    readiness.project === 'configured' &&
    readiness.token === 'available' &&
    readiness.registration === 'registered'
  );
}

export function shouldUpsertCurrentNotificationToken(input: {
  authenticated: boolean;
  permission: NotificationPermissionState;
  project: NotificationProjectState;
  token: NotificationTokenState;
}): boolean {
  return (
    input.authenticated &&
    input.permission === 'granted' &&
    input.project === 'configured' &&
    input.token === 'available'
  );
}
