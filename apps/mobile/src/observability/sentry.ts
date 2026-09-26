import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from './sanitize';

const environment = process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? 'development' : 'production');
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
const version = Constants.expoConfig?.version ?? 'unknown';
const nativeBuild =
  Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode?.toString();
const releaseSha = Constants.expoConfig?.extra?.releaseSha;
const release = `runcast-mobile@${version}${
  typeof releaseSha === 'string' && releaseSha ? `+${releaseSha.slice(0, 12)}` : ''
}`;

export const sentryEnabled = Boolean(dsn) && environment !== 'development';

Sentry.init({
  dsn,
  enabled: sentryEnabled,
  environment,
  release,
  ...(nativeBuild ? { dist: nativeBuild } : {}),
  sendDefaultPii: false,
  enableAutoSessionTracking: true,
  enableAutoPerformanceTracing: false,
  enableAppStartTracking: false,
  enableNativeFramesTracking: false,
  enableStallTracking: false,
  enableUserInteractionTracing: false,
  enableCaptureFailedRequests: false,
  attachScreenshot: false,
  attachViewHierarchy: false,
  attachThreads: false,
  enableLogs: false,
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  integrations: (defaults) =>
    defaults.filter(
      (integration) =>
        !/(?:replay|screenshot|viewhierarchy|httpclient|browsertracing|reactnativetracing|feedback|userinteraction)/i.test(
          integration.name,
        ),
    ),
  beforeSend: (event) => sanitizeSentryEvent(event),
  beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb),
});

if (typeof releaseSha === 'string' && releaseSha) Sentry.setTag('release_sha', releaseSha);

let localReferenceSequence = 0;

function localReference(): string {
  localReferenceSequence += 1;
  return `local-${Date.now().toString(36)}-${localReferenceSequence.toString(36)}`;
}

export function captureAppException(error: unknown): string {
  return sentryEnabled ? Sentry.captureException(error) : localReference();
}
