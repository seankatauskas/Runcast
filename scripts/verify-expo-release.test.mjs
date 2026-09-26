import { describe, expect, it } from 'vitest';
import { evaluateExpoRelease } from './verify-expo-release.mjs';

const projectId = '00000000-0000-0000-0000-000000000057';
const sha = '0123456789abcdef';

function candidate() {
  return {
    config: {
      extra: { eas: { projectId }, releaseSha: sha },
      updates: { url: `https://u.expo.dev/${projectId}` },
      ios: {
        bundleIdentifier: 'com.seankatauskas.runcast',
        privacyManifests: { NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [] },
      },
      plugins: ['@sentry/react-native/expo', ['expo-notifications', {}]],
    },
    eas: {
      build: {
        production: {
          environment: 'production',
          env: {
            EXPO_PUBLIC_API_URL: 'https://api.runcast.app',
            EXPO_PUBLIC_APP_ENV: 'production',
          },
        },
      },
    },
    environment: {
      EAS_PROJECT_ID: projectId,
      GITHUB_SHA: sha,
      EXPO_PUBLIC_API_URL: 'https://api.runcast.app',
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_LEGAL_BASE_URL: 'https://runcast-legal.onrender.com',
    },
  };
}

describe('production Expo release config', () => {
  it('accepts a pinned production project, release, services, and privacy config', () => {
    expect(evaluateExpoRelease(candidate())).toEqual({
      ok: true,
      checks: expect.objectContaining({
        projectId: true,
        releaseSha: true,
        productionEnvironment: true,
        privacyManifest: true,
      }),
    });
  });

  it.each([
    ['missing project ID', (value) => delete value.environment.EAS_PROJECT_ID],
    ['wrong release SHA', (value) => (value.config.extra.releaseSha = 'old')],
    ['staging API', (value) => (value.eas.build.production.env.EXPO_PUBLIC_API_URL = 'staging')],
    ['missing Sentry plugin', (value) => value.config.plugins.shift()],
  ])('blocks %s', (_label, mutate) => {
    const value = candidate();
    mutate(value);
    expect(evaluateExpoRelease(value).ok).toBe(false);
  });
});
