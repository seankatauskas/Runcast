import { describe, expect, it } from 'vitest';
import { appIdentityForEnvironment, projectIdFromEnvironment } from './app.config';

describe('EAS project configuration', () => {
  it('uses the explicit local/CI project ID when supplied', () => {
    expect(
      projectIdFromEnvironment({
        EAS_PROJECT_ID: 'ci-project',
        EAS_BUILD_PROJECT_ID: 'remote-project',
      }),
    ).toBe('ci-project');
  });

  it('uses the EAS worker built-in project ID on remote builds', () => {
    expect(projectIdFromEnvironment({ EAS_BUILD_PROJECT_ID: 'remote-project' })).toBe(
      'remote-project',
    );
  });
});

describe('build profile identity', () => {
  it.each([
    ['development', false, 'runcast-dev', 'com.seankatauskas.runcast.dev'],
    ['preview', false, 'runcast-preview', 'com.seankatauskas.runcast.preview'],
    ['production', false, 'runcast', 'com.seankatauskas.runcast'],
    ['e2e', true, 'runcast-e2e', 'com.seankatauskas.runcast.e2e'],
  ])('isolates the %s profile', (environment, e2e, scheme, applicationId) => {
    expect(appIdentityForEnvironment(environment, e2e)).toMatchObject({
      scheme,
      applicationId,
    });
  });

  it('does not permit the E2E switch outside its profile', () => {
    expect(() => appIdentityForEnvironment('preview', true)).toThrow(
      'EXPO_PUBLIC_E2E_MODE requires EXPO_PUBLIC_APP_ENV=e2e.',
    );
  });
});
