import { describe, expect, it } from 'vitest';
import {
  weeklyStartScheduleSchema,
  createGpxRouteSchema,
  createWatchSchema,
  deviceStatusSchema,
  identityStatusSchema,
  notificationPayloadSchema,
  routeImportResultSchema,
  stravaAuthAuthorizationRequestSchema,
  stravaExchangeRequestSchema,
  updateRouteSchema,
  updatePreferencesSchema,
  updateWatchSchema,
  watchResultSummarySchema,
} from './index';

describe('API contracts', () => {
  it('rejects unknown preference fields', () => {
    expect(() =>
      updatePreferencesSchema.parse({
        units: 'metric',
        temperatureUnit: 'celsius',
        theme: 'dark',
        defaultSpeed: 3,
        acceptableStartMinutes: 300,
        acceptableEndMinutes: 1320,
        version: 1,
        admin: true,
      }),
    ).toThrow();
  });

  it('validates a quarter-hour acceptable start window of at least one hour', () => {
    const values = {
      units: 'metric' as const,
      temperatureUnit: 'celsius' as const,
      theme: 'dark' as const,
      defaultSpeed: 3,
      acceptableStartMinutes: 300,
      acceptableEndMinutes: 1320,
      version: 1,
    };
    expect(updatePreferencesSchema.parse(values)).toEqual(values);
    expect(() =>
      updatePreferencesSchema.parse({ ...values, acceptableStartMinutes: 307 }),
    ).toThrow();
    expect(() => updatePreferencesSchema.parse({ ...values, acceptableEndMinutes: 345 })).toThrow();
  });

  it('requires same-day watch windows of at least one hour', () => {
    const base = {
      routeId: '2f272b14-601d-4be1-a219-e63967069aac',
      weekdays: 62,
      timezone: 'America/Chicago',
      startMinutes: 360,
      endMinutes: 420,
      speed: 3,
      leadMinutes: 60 as const,
      enabled: true,
    };
    expect(createWatchSchema.parse(base).endMinutes).toBe(420);
    expect(() => createWatchSchema.parse({ ...base, endMinutes: 419 })).toThrow();
    expect(() => createWatchSchema.parse({ ...base, endMinutes: 120 })).toThrow();
    expect(() => createWatchSchema.parse({ ...base, startMinutes: 367 })).toThrow();
    expect(() => createWatchSchema.parse({ ...base, endMinutes: 427 })).toThrow();
    expect(updateWatchSchema.parse({ enabled: false, version: 1 })).toEqual({
      enabled: false,
      version: 1,
    });
    expect(() => updateWatchSchema.parse({ startMinutes: 367, version: 1 })).toThrow();
  });

  it('validates immutable watch result summary metadata', () => {
    const summary = {
      evaluationId: crypto.randomUUID(),
      watchId: crypto.randomUUID(),
      occurrenceDate: '2026-08-16',
      status: 'recommended' as const,
      recommendedStart: '2026-08-16T11:00:00.000Z',
      evaluatedAt: '2026-08-16T10:00:00.000Z',
      forecastFetchedAt: '2026-08-16T09:45:00.000Z',
      reasonCodes: [],
      notificationRevision: 1 as const,
      notifiedAt: '2026-08-16T10:00:00.000Z',
    };
    expect(watchResultSummarySchema.parse(summary)).toEqual(summary);
    expect(() => watchResultSummarySchema.parse({ ...summary, notificationRevision: 3 })).toThrow();
  });

  it('caps GPX request bodies', () => {
    expect(() => createGpxRouteSchema.parse({ gpx: 'x'.repeat(2_000_001) })).toThrow();
  });

  it('validates route lifecycle metadata and trimmed rename requests', () => {
    const summary = {
      id: '2f272b14-601d-4be1-a219-e63967069aac',
      name: 'Morning loop',
      source: 'gpx' as const,
      origin: 'cloud-gpx' as const,
      providerId: null,
      geometryIdentity: 'geometry-identity',
      distance: 5000,
      importStatus: 'ready' as const,
      version: 2,
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:05:00.000Z',
      deduplicated: false,
    };
    expect(routeImportResultSchema.parse(summary)).toEqual(summary);
    expect(updateRouteSchema.parse({ name: ' New name ', version: 2 }).name).toBe('New name');
    expect(() => updateRouteSchema.parse({ name: '   ' })).toThrow();
  });

  it('strictly validates Strava sign-in authorization and exchange requests', () => {
    const authorization = {
      purpose: 'sign_in' as const,
      deviceId: 'device-identifier',
      redirectUri: 'runcast://auth/strava',
    };
    expect(stravaAuthAuthorizationRequestSchema.parse(authorization)).toEqual(authorization);
    expect(() =>
      stravaAuthAuthorizationRequestSchema.parse({ ...authorization, userId: crypto.randomUUID() }),
    ).toThrow();
    expect(() =>
      stravaAuthAuthorizationRequestSchema.parse({
        ...authorization,
        redirectUri: 'not a redirect',
      }),
    ).toThrow();
    expect(() =>
      stravaExchangeRequestSchema.parse({ code: 'short', deviceId: authorization.deviceId }),
    ).toThrow();
    expect(() =>
      stravaExchangeRequestSchema.parse({
        code: 'x'.repeat(513),
        deviceId: authorization.deviceId,
      }),
    ).toThrow();
  });

  it('rejects duplicate or unknown identity providers', () => {
    expect(identityStatusSchema.parse({ providers: ['strava', 'apple'] })).toEqual({
      providers: ['strava', 'apple'],
    });
    expect(() => identityStatusSchema.parse({ providers: ['strava', 'strava'] })).toThrow();
    expect(() => identityStatusSchema.parse({ providers: ['google'] })).toThrow();
    expect(() => identityStatusSchema.parse({ providers: [], connected: true })).toThrow();
  });

  it('validates finite device readiness states', () => {
    expect(
      deviceStatusSchema.parse({
        state: 'unregistered',
        enabledWatchCount: 0,
        installation: null,
      }),
    ).toMatchObject({ state: 'unregistered' });
    expect(() =>
      deviceStatusSchema.parse({
        state: 'waiting',
        enabledWatchCount: 0,
        installation: null,
      }),
    ).toThrow();
  });

  it('uses one strict, versioned notification payload', () => {
    const payload = {
      schemaVersion: 1 as const,
      type: 'watch-recommendation' as const,
      route: { id: crypto.randomUUID(), name: 'Lakefront' },
      watch: { id: crypto.randomUUID(), occurrenceDate: '2026-08-16' },
      delivery: { id: crypto.randomUUID() },
      snapshot: {
        engine: 'planning-v2' as const,
        id: crypto.randomUUID(),
        status: 'recommended' as const,
      },
      start: '2026-08-16T11:00:00.000Z',
      url: 'runcast://routes/route-id?start=1786878000000',
    };
    expect(notificationPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      notificationPayloadSchema.parse({ ...payload, routeId: payload.route.id }),
    ).toThrow();
    expect(() => notificationPayloadSchema.parse({ ...payload, schemaVersion: 2 })).toThrow();
    expect(() =>
      notificationPayloadSchema.parse({ ...payload, url: 'https://example.com' }),
    ).toThrow();
  });
});

describe('weekly schedule contract', () => {
  const week = {
    mon: [{ startMinutes: 360, endMinutes: 480 }],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [{ startMinutes: 1380, endMinutes: 1440 }],
  };
  it('accepts days off and midnight ends', () => {
    expect(weeklyStartScheduleSchema.parse(week)).toEqual(week);
  });
  it.each([
    { ...week, mon: undefined },
    { ...week, mon: [{ startMinutes: 361, endMinutes: 480 }] },
    { ...week, mon: [{ startMinutes: 360, endMinutes: 360 }] },
    { ...week, mon: [{ startMinutes: 1440, endMinutes: 1440 }] },
    { ...week, extra: null },
    {
      ...week,
      mon: [
        { startMinutes: 360, endMinutes: 480 },
        { startMinutes: 420, endMinutes: 540 },
      ],
    },
  ])('rejects incomplete or invalid weeks', (value) => {
    expect(weeklyStartScheduleSchema.safeParse(value).success).toBe(false);
  });
});
