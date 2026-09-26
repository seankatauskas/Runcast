import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function pluginNames(plugins) {
  return (plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}

export function evaluateExpoRelease({ config, eas, environment }) {
  const projectId = environment.EAS_PROJECT_ID;
  const expectedSha = environment.GITHUB_SHA;
  const production = eas?.build?.production;
  const plugins = pluginNames(config?.plugins);
  const checks = {
    projectId: Boolean(projectId) && config?.extra?.eas?.projectId === projectId,
    updatesUrl: Boolean(projectId) && config?.updates?.url === `https://u.expo.dev/${projectId}`,
    releaseSha: Boolean(expectedSha) && config?.extra?.releaseSha === expectedSha,
    bundleId: config?.ios?.bundleIdentifier === 'com.seankatauskas.runcast',
    productionEnvironment: production?.environment === 'production',
    productionApi:
      production?.env?.EXPO_PUBLIC_API_URL === 'https://api.runcast.app' &&
      environment.EXPO_PUBLIC_API_URL === 'https://api.runcast.app',
    productionAppEnvironment:
      production?.env?.EXPO_PUBLIC_APP_ENV === 'production' &&
      environment.EXPO_PUBLIC_APP_ENV === 'production',
    legalUrl: environment.EXPO_PUBLIC_LEGAL_BASE_URL === 'https://runcast-legal.onrender.com',
    sentryPlugin: plugins.includes('@sentry/react-native/expo'),
    notificationPlugin: plugins.includes('expo-notifications'),
    privacyManifest:
      config?.ios?.privacyManifests?.NSPrivacyTracking === false &&
      Array.isArray(config?.ios?.privacyManifests?.NSPrivacyCollectedDataTypes),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function loadExpoRelease(projectDirectory, environment = process.env) {
  const result = spawnSync('npx', ['expo', 'config', '--type', 'public', '--json'], {
    cwd: projectDirectory,
    encoding: 'utf8',
    maxBuffer: 10_000_000,
    env: environment,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error('Expo public config did not complete normally');
  }
  let config;
  try {
    config = JSON.parse(result.stdout);
  } catch {
    throw new Error('Expo public config did not return valid JSON');
  }
  const eas = JSON.parse(readFileSync(resolve(projectDirectory, 'eas.json'), 'utf8'));
  return { config, eas };
}

function main() {
  const [projectDirectory = 'apps/mobile'] = process.argv.slice(2);
  const loaded = loadExpoRelease(resolve(projectDirectory));
  const result = evaluateExpoRelease({ ...loaded, environment: process.env });
  console.log(JSON.stringify({ event: 'expo.release-config', ...result }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
