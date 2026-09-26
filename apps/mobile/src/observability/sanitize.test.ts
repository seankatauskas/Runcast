import { describe, expect, it } from 'vitest';
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from './sanitize';

const forbidden = [
  'runner@example.com',
  'Home and work loop',
  '41.881832',
  '-87.623177',
  '<gpx',
  'access-secret',
  'ExponentPushToken[push-secret]',
  'forecast-provider-payload',
];

describe('Sentry privacy sanitizer', () => {
  it('removes identity, routes, provider data, bodies, and credentials from events', () => {
    const sanitized = sanitizeSentryEvent({
      event_id: 'event-1',
      message: 'Request failed at 41.881832, -87.623177',
      user: { email: 'runner@example.com', id: 'account-1' },
      request: { data: { gpx: '<gpx>secret</gpx>' } },
      extra: { providerPayload: 'forecast-provider-payload' },
      contexts: { route: { routeName: 'Home and work loop', geometry: [41.881832, -87.623177] } },
      tags: {
        routeName: 'Home and work loop',
        authorization: 'Bearer access-secret',
        pushToken: 'ExponentPushToken[push-secret]',
      },
      exception: {
        values: [
          {
            type: 'Error',
            value:
              'Bearer access-secret ExponentPushToken[push-secret] runner@example.com <gpx>secret</gpx>',
          },
        ],
      },
    });
    const output = JSON.stringify(sanitized);
    for (const value of forbidden) expect(output).not.toContain(value);
    expect(sanitized).not.toHaveProperty('user');
    expect(sanitized).not.toHaveProperty('request');
    expect(sanitized).not.toHaveProperty('extra');
    expect(sanitized).not.toHaveProperty('contexts');
    expect(sanitized.event_id).toBe('event-1');
  });

  it('drops default network/UI breadcrumbs and keeps only safe operational references', () => {
    expect(
      sanitizeSentryBreadcrumb({
        category: 'fetch',
        data: { url: 'https://api.example/routes/home', body: '<gpx>secret</gpx>' },
      }),
    ).toBeNull();
    expect(
      sanitizeSentryBreadcrumb({
        category: 'runcast.sync',
        message: 'sync failed',
        data: {
          requestId: 'request-1',
          method: 'GET',
          routeName: 'Home and work loop',
          providerPayload: 'forecast-provider-payload',
        },
      }),
    ).toEqual({
      category: 'runcast.sync',
      message: 'sync failed',
      data: { requestId: 'request-1', method: 'GET' },
    });
  });
});
