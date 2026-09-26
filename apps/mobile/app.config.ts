import type { ConfigContext, ExpoConfig } from 'expo/config';

export function projectIdFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  return environment.EAS_PROJECT_ID ?? environment.EAS_BUILD_PROJECT_ID;
}

export function appIdentityForEnvironment(
  appEnvironment: string | undefined,
  e2eRequested: boolean,
): { name: string; scheme: string; applicationId: string; e2eBuild: boolean } {
  if (e2eRequested && appEnvironment !== 'e2e') {
    throw new Error('EXPO_PUBLIC_E2E_MODE requires EXPO_PUBLIC_APP_ENV=e2e.');
  }
  if (e2eRequested) {
    return {
      name: 'Runcast E2E',
      scheme: 'runcast-e2e',
      applicationId: 'com.seankatauskas.runcast.e2e',
      e2eBuild: true,
    };
  }
  if (appEnvironment === 'development') {
    return {
      name: 'Runcast Dev',
      scheme: 'runcast-dev',
      applicationId: 'com.seankatauskas.runcast.dev',
      e2eBuild: false,
    };
  }
  if (appEnvironment === 'preview') {
    return {
      name: 'Runcast Preview',
      scheme: 'runcast-preview',
      applicationId: 'com.seankatauskas.runcast.preview',
      e2eBuild: false,
    };
  }
  return {
    name: 'Runcast',
    scheme: 'runcast',
    applicationId: 'com.seankatauskas.runcast',
    e2eBuild: false,
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = projectIdFromEnvironment();
  const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
  const e2eRequested = process.env.EXPO_PUBLIC_E2E_MODE === 'enabled';
  const identity = appIdentityForEnvironment(appEnvironment, e2eRequested);
  const releaseSha =
    process.env.EAS_BUILD_GIT_COMMIT_HASH ?? process.env.GITHUB_SHA ?? process.env.RELEASE_SHA;
  return {
    ...config,
    name: identity.name,
    slug: config.slug ?? 'runcast',
    scheme: identity.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: identity.applicationId,
    },
    android: {
      ...config.android,
      package: identity.applicationId,
    },
    extra: {
      ...config.extra,
      eas: projectId ? { projectId } : undefined,
      releaseSha,
      appEnvironment: appEnvironment ?? 'production',
      deepLinkScheme: identity.scheme,
      e2eBuild: identity.e2eBuild,
    },
    updates: projectId ? { url: `https://u.expo.dev/${projectId}` } : undefined,
  };
};
