import { randomUUID } from 'node:crypto';
import type { PlanningBundleV2 } from '@runcast/contracts';
import {
  FORECAST_FRESHNESS_MS,
  PLANNING_ALGORITHM_VERSION_MANIFEST,
  contentIdentity,
  parseGpx,
  parsePlanningGpx,
  unknownLegacyCoverageMask,
  type NormalizedRouteForecast,
  type LegacyWeatherField,
  type ForecastVariable,
} from '@runcast/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpoTicket } from '../providers/expo';

const provider = vi.hoisted(() => ({
  athleteId: 'athlete-100',
  appleEndpointIdentityToken: null as string | null,
  appleServerEventType: 'consent-revoked',
  revokeApple: vi.fn(async () => {}),
  revokeStrava: vi.fn(async () => {}),
}));

const expoProvider = vi.hoisted(() => ({
  send: vi.fn(async (): Promise<ExpoTicket> => ({ status: 'ok', id: 'expo-ticket-fixture' })),
  receipts: vi.fn(async () => ({})),
}));

vi.mock('../providers/strava', () => ({
  exchangeStravaCode: vi.fn(async () => ({
    accessToken: `access-${provider.athleteId}`,
    refreshToken: `refresh-${provider.athleteId}`,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    athleteId: provider.athleteId,
    athleteDisplayName: `Runner ${provider.athleteId}`,
  })),
  refreshStravaToken: vi.fn(),
  revokeStravaToken: provider.revokeStrava,
  stravaAuthorizationUrl: (state: string) => `https://strava.test/oauth?state=${state}`,
  listStravaRoutes: vi.fn(async () => []),
  exportStravaRoute: vi.fn(),
}));

vi.mock('../providers/apple', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers/apple')>();
  return {
    ...actual,
    verifyAppleIdentity: vi.fn(async (identityToken: string) => ({
      subject: identityToken,
      email: `${identityToken.slice(0, 8)}@example.test`,
    })),
    exchangeAppleCode: vi.fn(async (authorizationCode: string) => ({
      refreshToken: 'apple-refresh-token',
      idToken: provider.appleEndpointIdentityToken ?? authorizationCode,
    })),
    revokeAppleToken: provider.revokeApple,
    verifyAppleServerNotification: vi.fn(async (signedPayload: string) => ({
      events: { type: provider.appleServerEventType, sub: signedPayload },
    })),
  };
});

vi.mock('../providers/expo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers/expo')>();
  return {
    ...actual,
    sendExpoPush: expoProvider.send,
    fetchExpoReceipts: expoProvider.receipts,
  };
});

import { buildApp } from '../app';
import { config } from '../config';
import { runScheduler as executeScheduler } from '../jobs/scheduler';
import {
  assemblePlanningBundleV2,
  historicalRecommendation,
} from './fixtures/historicalPlanningBundle';
import {
  appendNotificationPublication,
  appendRecommendationEvaluation,
} from '../planning/evaluations';
import { OpenMeteoRouteForecastPreparer, UsdaRouteCanopyPreparer } from '../planning/runtime';
import { unknownCanopyForRoute } from '../planning/canopy';
import { PostgresRouteForecastRepository } from '../planning/postgres';
import { preparedRouteForecastFromForecast } from '../planning/bundle';
import { createSession, rotateSession } from '../session';
import { closeDatabase, db, sql } from './client';
import {
  authIdentities,
  deletionAudits,
  deviceInstallations,
  notificationDeliveries,
  notificationPublications,
  oauthStates,
  preferences,
  recommendationEvaluations,
  routeCanopyProfiles,
  routeForecasts,
  routes,
  sessions,
  stravaConnections,
  stravaExchangeCodes,
  systemHeartbeats,
  users,
  watchRecommendations,
  watches,
} from './schema';

const runScheduler = (now: Date) => executeScheduler(now, () => now);

const integration = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;

function appleBody(subject: string, deviceId = 'device-apple-123') {
  const identityToken = subject.padEnd(32, '-');
  return {
    identityToken,
    authorizationCode: identityToken,
    nonce: 'apple-raw-nonce-1234',
    deviceId,
  };
}

const V2_WEATHER_VARIABLES: ForecastVariable[] = [
  'temperatureC',
  'feelsLikeC',
  'humidityPct',
  'windSpeedMs',
  'windDirectionFromDeg',
  'gustMs',
  'cloudCoverPct',
  'precipitationProbabilityPct',
  'precipitationMm',
  'weatherCode',
  'shortwaveRadiationWm2',
  'directNormalRadiationWm2',
  'diffuseRadiationWm2',
];

function planningWeather(
  now: number,
  overrides: Partial<Record<ForecastVariable, number>> = {},
): NormalizedRouteForecast {
  const values = Object.fromEntries(
    V2_WEATHER_VARIABLES.map((variable) => [
      variable,
      [overrides[variable] ?? 1, overrides[variable] ?? 1],
    ]),
  ) as Record<ForecastVariable, number[]>;
  const variables = Object.fromEntries(
    V2_WEATHER_VARIABLES.map((variable) => [
      variable,
      {
        semantics: 'instant' as const,
        unit: 'fixture',
        validRange: [-100, 2_000] as [number, number],
        required: true,
      },
    ]),
  ) as unknown as NormalizedRouteForecast['variables'];
  const body = {
    schemaVersion: 2 as const,
    normalizationVersion: 'fixture-v2',
    provider: 'fixture',
    providerModel: null,
    providerRun: null,
    fetchId: `fixture-${now}`,
    fetchedAt: now,
    validFrom: now - 60_000,
    validUntil: now + 4 * 3_600_000,
    requestedCoordinates: [{ lat: 41, lon: -87 }],
    returnedCoordinates: [{ lat: 41, lon: -87 }],
    variables,
    anchors: [
      {
        routeDistanceM: 0,
        lat: 41,
        lon: -87,
        hourly: { time: [now - 60_000, now + 4 * 3_600_000], values },
      },
    ],
    missingCounts: Object.fromEntries(
      V2_WEATHER_VARIABLES.map((variable) => [variable, 0]),
    ) as Record<ForecastVariable, number>,
    reasons: [],
  };
  return { ...body, contentHash: contentIdentity(body) };
}

function legacyPlanningWeather(now: number): LegacyWeatherField {
  const time = [now - 60_000, now + 4 * 3_600_000];
  const values = [1, 1];
  return {
    fetchedAt: now,
    anchors: [
      {
        routeDistance: 0,
        lat: 41,
        lon: -87,
        hourly: {
          time,
          temp: values,
          feelsLike: values,
          humidity: values,
          windSpeed: values,
          windDirFrom: values,
          gust: values,
          cloudCover: values,
          precipProb: values,
          precip: values,
          weatherCode: values,
        },
      },
    ],
  };
}

async function authorizeStrava(
  app: FastifyInstance,
  input: {
    deviceId: string;
    purpose?: 'sign_in' | 'link';
    accessToken?: string;
    redirectUri?: string;
  },
) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/strava/authorization',
    headers: input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : undefined,
    payload: {
      purpose: input.purpose ?? 'sign_in',
      deviceId: input.deviceId,
      redirectUri: input.redirectUri ?? 'runcast://auth/strava',
    },
  });
  expect(response.statusCode).toBe(200);
  const authorizationUrl = new URL(response.json().authorizationUrl as string);
  return authorizationUrl.searchParams.get('state')!;
}

async function finishStravaCallback(app: FastifyInstance, state: string) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/integrations/strava/callback?code=provider-code&scope=read,read_all&state=${encodeURIComponent(state)}`,
  });
  expect(response.statusCode).toBe(302);
  return new URL(response.headers.location!);
}

async function signInStrava(app: FastifyInstance, deviceId: string) {
  const state = await authorizeStrava(app, { deviceId });
  const callback = await finishStravaCallback(app, state);
  const code = callback.searchParams.get('code');
  expect(code).toBeTruthy();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/strava/exchange',
    payload: { code, deviceId },
  });
  expect([200, 201]).toContain(response.statusCode);
  return { body: response.json(), state, code: code! };
}

integration('provider-neutral authentication and ownership', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(async () => {
    vi.spyOn(UsdaRouteCanopyPreparer.prototype, 'prepare').mockImplementation(async (route) =>
      unknownCanopyForRoute(route),
    );
    provider.athleteId = 'athlete-100';
    provider.appleEndpointIdentityToken = null;
    provider.appleServerEventType = 'consent-revoked';
    provider.revokeApple.mockClear();
    provider.revokeStrava.mockClear();
    expoProvider.send.mockClear();
    expoProvider.receipts.mockClear();
    await sql`TRUNCATE oauth_states, strava_exchange_codes, users, deletion_audits CASCADE`;
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it('creates exactly one neutral account, Strava identity, connection, preferences, and session', async () => {
    const signedIn = await signInStrava(app, 'device-strava-100');
    expect(signedIn.body.isNewUser).toBe(true);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(authIdentities)).toHaveLength(1);
    expect(await db.select().from(stravaConnections)).toHaveLength(1);
    expect(await db.select().from(preferences)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(1);

    const [storedState] = await db.select().from(oauthStates);
    const [storedExchange] = await db.select().from(stravaExchangeCodes);
    expect(storedState.stateHash).not.toBe(signedIn.state);
    expect(storedExchange.codeHash).not.toBe(signedIn.code);
    expect(storedExchange.deviceId).toBe('device-strava-100');
    expect(storedExchange.consumedAt).not.toBeNull();
  });

  it('round-trips weekly schedules, preserves them for old clients, and checks versions', async () => {
    const [user] = await db.insert(users).values({}).returning();
    await db.insert(preferences).values({ userId: user.id });
    const session = await createSession(user.id, 'device-schedule-100');
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const initial = (
      await app.inject({ method: 'GET', url: '/v1/me/preferences', headers })
    ).json();
    const { updatedAt: _updatedAt, ...values } = initial;
    const weeklyStartSchedule = {
      mon: [{ startMinutes: 360, endMinutes: 480 }],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [{ startMinutes: 420, endMinutes: 600 }],
      sun: [],
    };
    const saved = await app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers,
      payload: { ...values, weeklyStartSchedule },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().weeklyStartSchedule).toEqual(weeklyStartSchedule);
    const { weeklyStartSchedule: _weekly, ...oldValues } = values;
    const oldClient = await app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers,
      payload: { ...oldValues, version: saved.json().version },
    });
    expect(oldClient.statusCode).toBe(200);
    expect(oldClient.json().weeklyStartSchedule).toEqual(weeklyStartSchedule);
    const reloaded = await app.inject({ method: 'GET', url: '/v1/me/preferences', headers });
    expect(reloaded.json().weeklyStartSchedule).toEqual(weeklyStartSchedule);
    const conflict = await app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers,
      payload: { ...values, weeklyStartSchedule },
    });
    expect(conflict.statusCode).toBe(409);
    const invalid = await app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers,
      payload: {
        ...values,
        version: oldClient.json().version,
        weeklyStartSchedule: {
          ...weeklyStartSchedule,
          mon: [{ startMinutes: 360, endMinutes: 360 }],
        },
      },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('returns the same account and owned data for a returning athlete', async () => {
    const first = await signInStrava(app, 'device-returning-1');
    const userId = first.body.user.id as string;
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><name>Saved</name><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Saved',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: userId,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: 'returning-test',
    });

    const second = await signInStrava(app, 'device-returning-2');
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.user.id).toBe(userId);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(routes).where(eq(routes.ownerId, userId))).toHaveLength(1);
  });

  it('makes OAuth states expiring and single-use', async () => {
    const state = await authorizeStrava(app, { deviceId: 'device-state-123' });
    await finishStravaCallback(app, state);
    const replay = await app.inject({
      method: 'GET',
      url: `/v1/integrations/strava/callback?code=again&state=${encodeURIComponent(state)}`,
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('INVALID_OAUTH_STATE');

    const expired = await authorizeStrava(app, { deviceId: 'device-state-expired' });
    await db
      .update(oauthStates)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(
        eq(
          oauthStates.stateHash,
          await import('../security/crypto').then((m) => m.hashToken(expired)),
        ),
      );
    const expiredResponse = await app.inject({
      method: 'GET',
      url: `/v1/integrations/strava/callback?code=late&state=${encodeURIComponent(expired)}`,
    });
    expect(expiredResponse.statusCode).toBe(400);
  });

  it('binds exchange codes to one device, expiry, single use, and concurrent consumption', async () => {
    const state = await authorizeStrava(app, { deviceId: 'device-bound-123' });
    const callback = await finishStravaCallback(app, state);
    const code = callback.searchParams.get('code')!;
    const wrongDevice = await app.inject({
      method: 'POST',
      url: '/v1/auth/strava/exchange',
      payload: { code, deviceId: 'different-device' },
    });
    expect(wrongDevice.statusCode).toBe(401);

    const [left, right] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/auth/strava/exchange',
        payload: { code, deviceId: 'device-bound-123' },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/auth/strava/exchange',
        payload: { code, deviceId: 'device-bound-123' },
      }),
    ]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([201, 401]);

    const expiredState = await authorizeStrava(app, { deviceId: 'device-code-expired' });
    const expiredCallback = await finishStravaCallback(app, expiredState);
    const expiredCode = expiredCallback.searchParams.get('code')!;
    await db
      .update(stravaExchangeCodes)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(stravaExchangeCodes.deviceId, 'device-code-expired'));
    const expired = await app.inject({
      method: 'POST',
      url: '/v1/auth/strava/exchange',
      payload: { code: expiredCode, deviceId: 'device-code-expired' },
    });
    expect(expired.statusCode).toBe(401);
  });

  it('keeps Apple guest sign-in compatible and links Apple to a Strava-created account', async () => {
    const appleGuest = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: appleBody('apple-guest'),
    });
    expect(appleGuest.statusCode).toBe(201);
    expect(appleGuest.json().isNewUser).toBe(true);

    provider.athleteId = 'athlete-link-apple';
    const strava = await signInStrava(app, 'device-link-apple');
    const linked = await app.inject({
      method: 'POST',
      url: '/v1/me/identities/apple',
      headers: { authorization: `Bearer ${strava.body.accessToken}` },
      payload: { ...appleBody('apple-linked'), deviceId: undefined },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().providers).toEqual(['strava', 'apple']);

    const identityStatus = await app.inject({
      method: 'GET',
      url: '/v1/me/identities',
      headers: { authorization: `Bearer ${strava.body.accessToken}` },
    });
    expect(identityStatus.json().providers).toEqual(['strava', 'apple']);
  });

  it('rejects Apple sign-in when the token endpoint identity has a different subject', async () => {
    provider.appleEndpointIdentityToken = 'different-apple-subject'.padEnd(32, '-');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: appleBody('initial-apple-subject'),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('APPLE_SUBJECT_MISMATCH');
    expect(await db.select().from(users)).toEqual([]);
  });

  it('rejects provider identity collisions without merging accounts', async () => {
    provider.athleteId = 'athlete-collision-a';
    const first = await signInStrava(app, 'device-collision-a');
    const firstLink = await app.inject({
      method: 'POST',
      url: '/v1/me/identities/apple',
      headers: { authorization: `Bearer ${first.body.accessToken}` },
      payload: { ...appleBody('shared-apple'), deviceId: undefined },
    });
    expect(firstLink.statusCode).toBe(201);

    provider.athleteId = 'athlete-collision-b';
    const second = await signInStrava(app, 'device-collision-b');
    const collision = await app.inject({
      method: 'POST',
      url: '/v1/me/identities/apple',
      headers: { authorization: `Bearer ${second.body.accessToken}` },
      payload: { ...appleBody('shared-apple'), deviceId: undefined },
    });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe('IDENTITY_ALREADY_LINKED');
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('preserves a sole Strava identity on legacy disconnect and permits disconnect when Apple is linked', async () => {
    const signedIn = await signInStrava(app, 'device-disconnect-123');
    const headers = { authorization: `Bearer ${signedIn.body.accessToken}` };
    const sole = await app.inject({
      method: 'DELETE',
      url: '/v1/integrations/strava',
      headers,
    });
    expect(sole.statusCode).toBe(409);
    expect(sole.json().error.code).toBe('SOLE_IDENTITY');

    await app.inject({
      method: 'POST',
      url: '/v1/me/identities/apple',
      headers,
      payload: { ...appleBody('disconnect-apple'), deviceId: undefined },
    });
    const disconnected = await app.inject({
      method: 'DELETE',
      url: '/v1/integrations/strava',
      headers,
    });
    expect(disconnected.statusCode).toBe(204);
    expect(await db.select().from(stravaConnections)).toEqual([]);
    expect(
      await db
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.userId, signedIn.body.user.id),
            eq(authIdentities.provider, 'strava'),
          ),
        ),
    ).toEqual([]);
  });

  it('signs out without revoking Strava and deletes all data after attempting provider revocations', async () => {
    const signedIn = await signInStrava(app, 'device-delete-123');
    const headers = { authorization: `Bearer ${signedIn.body.accessToken}` };
    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers,
      payload: { refreshToken: signedIn.body.refreshToken, allDevices: false },
    });
    expect(logout.statusCode).toBe(204);
    expect(await db.select().from(stravaConnections)).toHaveLength(1);
    expect(provider.revokeStrava).not.toHaveBeenCalled();

    const fresh = await signInStrava(app, 'device-delete-fresh');
    await app.inject({
      method: 'POST',
      url: '/v1/me/identities/apple',
      headers: { authorization: `Bearer ${fresh.body.accessToken}` },
      payload: { ...appleBody('delete-apple'), deviceId: undefined },
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: `Bearer ${fresh.body.accessToken}` },
    });
    expect(deleted.statusCode).toBe(204);
    expect(provider.revokeStrava).toHaveBeenCalledOnce();
    expect(provider.revokeApple).toHaveBeenCalledOnce();
    expect(await db.select().from(users)).toEqual([]);
    expect(await db.select().from(deletionAudits)).toHaveLength(1);
  });

  it('removes Apple from dual-provider accounts but deletes Apple-only accounts on revocation', async () => {
    const dual = await signInStrava(app, 'device-revocation-dual');
    const dualApple = appleBody('revocation-dual').identityToken;
    await app.inject({
      method: 'POST',
      url: '/v1/me/identities/apple',
      headers: { authorization: `Bearer ${dual.body.accessToken}` },
      payload: { ...appleBody('revocation-dual'), deviceId: undefined },
    });
    provider.appleServerEventType = 'email-disabled';
    const ignoredWebhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/apple',
      payload: { signedPayload: dualApple },
    });
    expect(ignoredWebhook.statusCode).toBe(204);
    expect(
      await db
        .select()
        .from(authIdentities)
        .where(
          and(eq(authIdentities.userId, dual.body.user.id), eq(authIdentities.provider, 'apple')),
        ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, dual.body.user.id), isNull(sessions.revokedAt))),
    ).toHaveLength(1);
    provider.appleServerEventType = 'consent-revoked';
    const dualWebhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/apple',
      payload: { signedPayload: dualApple },
    });
    expect(dualWebhook.statusCode).toBe(204);
    expect(await db.select().from(users).where(eq(users.id, dual.body.user.id))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(authIdentities)
        .where(
          and(eq(authIdentities.userId, dual.body.user.id), eq(authIdentities.provider, 'apple')),
        ),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, dual.body.user.id), isNull(sessions.revokedAt))),
    ).toEqual([]);

    const appleOnlyBody = appleBody('revocation-only', 'device-revocation-only');
    const appleOnly = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: appleOnlyBody,
    });
    await app.inject({
      method: 'POST',
      url: '/v1/webhooks/apple',
      payload: { signedPayload: appleOnlyBody.identityToken },
    });
    expect(await db.select().from(users).where(eq(users.id, appleOnly.json().user.id))).toEqual([]);
  });

  it('enforces strict requests, redirect allowlisting, and global provider constraints', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/strava/authorization',
      payload: {
        purpose: 'sign_in',
        deviceId: 'device-strict-123',
        redirectUri: 'runcast://auth/strava',
        userId: randomUUID(),
      },
    });
    expect(unknown.statusCode).toBe(400);
    const redirect = await app.inject({
      method: 'POST',
      url: '/v1/auth/strava/authorization',
      payload: {
        purpose: 'sign_in',
        deviceId: 'device-strict-123',
        redirectUri: 'runcast://auth/strava?forward=https://evil.test',
      },
    });
    expect(redirect.statusCode).toBe(400);
    expect(redirect.json().error.code).toBe('INVALID_REDIRECT_URI');

    const [first, second] = await db.insert(users).values([{}, {}]).returning();
    await db.insert(authIdentities).values({
      userId: first.id,
      provider: 'apple',
      providerSubject: 'constraint-apple',
    });
    await expect(
      db.insert(authIdentities).values({
        userId: second.id,
        provider: 'apple',
        providerSubject: 'constraint-apple',
      }),
    ).rejects.toThrow();
  });

  it('cascades all owned route and watch data on account deletion', async () => {
    const [user] = await db.insert(users).values({}).returning();
    await db.insert(authIdentities).values({
      userId: user.id,
      provider: 'apple',
      providerSubject: `test-${randomUUID()}`,
    });
    await db.insert(preferences).values({ userId: user.id });
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><name>Test</name><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Test',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: 'test',
    });
    await db.insert(routeCanopyProfiles).values({
      routeId,
      coordinateHash: 'test',
      sourceVersion: 'v2025-6',
    });
    const [watch] = await db
      .insert(watches)
      .values({
        userId: user.id,
        routeId,
        weekdays: 127,
        timezone: 'America/Chicago',
        startMinutes: 360,
        endMinutes: 480,
        speed: 3,
        leadMinutes: 60,
      })
      .returning();
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(routes).where(eq(routes.id, routeId))).toEqual([]);
    expect(
      await db.select().from(routeCanopyProfiles).where(eq(routeCanopyProfiles.routeId, routeId)),
    ).toEqual([]);
    expect(await db.select().from(watches).where(eq(watches.id, watch.id))).toEqual([]);
  });

  it('requires authentication when starting a link-purpose authorization', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/strava/authorization',
      payload: {
        purpose: 'link',
        deviceId: 'device-link-auth',
        redirectUri: 'runcast://auth/strava',
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('links Strava to an Apple-created account and reports collisions in the callback', async () => {
    const apple = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: appleBody('apple-link-strava', 'device-apple-link'),
    });
    provider.athleteId = 'athlete-already-owned';
    await signInStrava(app, 'device-athlete-owner');

    const state = await authorizeStrava(app, {
      deviceId: 'device-apple-link',
      purpose: 'link',
      accessToken: apple.json().accessToken,
    });
    const collision = await finishStravaCallback(app, state);
    expect(collision.searchParams.get('error')).toBe('IDENTITY_ALREADY_LINKED');
    expect(provider.revokeStrava).toHaveBeenCalledOnce();

    provider.athleteId = 'athlete-new-link';
    const linkState = await authorizeStrava(app, {
      deviceId: 'device-apple-link',
      purpose: 'link',
      accessToken: apple.json().accessToken,
    });
    const linked = await finishStravaCallback(app, linkState);
    expect(linked.searchParams.get('strava')).toBe('connected');
    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, apple.json().user.id));
    expect(identities.map(({ provider: name }) => name).sort()).toEqual(['apple', 'strava']);
  });

  it('can create authenticated fixtures without exposing refresh-token hashes', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const fixture = await createSession(user.id, 'device-fixture-123');
    const [stored] = await db.select().from(sessions).where(eq(sessions.id, fixture.sessionId));
    expect(stored.refreshTokenHash).not.toBe(fixture.refreshToken);
  });

  it('commits user-wide invalidation before reporting refresh-token reuse', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const rotated = await createSession(user.id, 'refresh-reuse-device');
    await createSession(user.id, 'refresh-reuse-sibling');
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: rotated.refreshToken, deviceId: 'refresh-reuse-device' },
    });
    expect(first.statusCode).toBe(200);
    const reuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: rotated.refreshToken, deviceId: 'refresh-reuse-device' },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(
      await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt))),
    ).toEqual([]);
  });

  it('invalidates the winning replacement when concurrent refresh rotation loses its compare-and-swap', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const current = await createSession(user.id, 'refresh-race-device');
    await createSession(user.id, 'refresh-race-sibling');
    let inserted = 0;
    let releaseBoth!: () => void;
    const bothInserted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const beforeCompareAndSwap = async () => {
      inserted += 1;
      if (inserted === 2) releaseBoth();
      await bothInserted;
    };
    const attempts = await Promise.allSettled([
      rotateSession(current.refreshToken, 'refresh-race-device', { beforeCompareAndSwap }),
      rotateSession(current.refreshToken, 'refresh-race-device', { beforeCompareAndSwap }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'REFRESH_TOKEN_REUSED' } });
    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(4);
    expect(
      await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt))),
    ).toEqual([]);
  });

  it('reports device readiness, rotates tokens, and deactivates idempotently', async () => {
    const [firstUser, secondUser] = await db.insert(users).values([{}, {}]).returning();
    const firstSession = await createSession(firstUser.id, 'device-ready-first');
    const secondSession = await createSession(secondUser.id, 'device-ready-second');
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Ready route',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: firstUser.id,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: 'device-ready-route',
    });
    await db.insert(watches).values({
      userId: firstUser.id,
      routeId,
      weekdays: 127,
      timezone: 'UTC',
      startMinutes: 360,
      endMinutes: 480,
      speed: 3,
      leadMinutes: 60,
    });
    const firstHeaders = { authorization: `Bearer ${firstSession.accessToken}` };
    const secondHeaders = { authorization: `Bearer ${secondSession.accessToken}` };

    const unregistered = await app.inject({
      method: 'GET',
      url: '/v1/devices/current',
      headers: firstHeaders,
    });
    expect(unregistered.json()).toMatchObject({
      state: 'unregistered',
      enabledWatchCount: 1,
      installation: null,
    });

    const register = async (headers: typeof firstHeaders, expoPushToken: string) =>
      app.inject({
        method: 'PUT',
        url: '/v1/devices/current',
        headers,
        payload: { expoPushToken, platform: 'ios', appVersion: '2.0.0', enabled: true },
      });
    expect((await register(firstHeaders, 'ExponentPushToken[first]')).json().state).toBe('ready');
    expect((await register(firstHeaders, 'ExponentPushToken[rotated]')).json().state).toBe('ready');
    expect(
      await db
        .select()
        .from(deviceInstallations)
        .where(eq(deviceInstallations.userId, firstUser.id)),
    ).toHaveLength(1);

    expect((await register(secondHeaders, 'ExponentPushToken[rotated]')).json().state).toBe(
      'no-enabled-watches',
    );
    const installations = await db.select().from(deviceInstallations);
    expect(installations.find((item) => item.userId === firstUser.id)?.enabled).toBe(false);
    expect(installations.find((item) => item.userId === secondUser.id)?.enabled).toBe(true);

    const disabled = await app.inject({
      method: 'GET',
      url: '/v1/devices/current',
      headers: firstHeaders,
    });
    expect(disabled.json().state).toBe('disabled');
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/devices/current',
        headers: secondHeaders,
      });
      expect(response.statusCode).toBe(204);
    }
  });

  it('returns watch weekday labels and the next server-computed occurrence', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const session = await createSession(user.id, 'watch-summary-device');
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Watch summary',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: 'watch-summary-route',
    });
    await db.insert(watches).values({
      userId: user.id,
      routeId,
      weekdays: (1 << 1) | (1 << 3) | (1 << 5),
      timezone: 'America/Chicago',
      startMinutes: 360,
      endMinutes: 480,
      speed: 3,
      leadMinutes: 60,
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/watches',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().latestResults).toEqual([]);
    expect(response.json().watches[0]).toMatchObject({
      weekdayNames: ['Monday', 'Wednesday', 'Friday'],
      nextOccurrence: {
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        windowStart: expect.stringMatching(/Z$/),
        windowEnd: expect.stringMatching(/Z$/),
      },
    });
  });

  it('requires quarter-hour create and edit values while preserving grandfathered schedules', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const session = await createSession(user.id, 'watch-quarter-hour-device');
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Grandfathered watch',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: 'grandfathered-watch-route',
    });
    const [legacy] = await db
      .insert(watches)
      .values({
        userId: user.id,
        routeId,
        weekdays: 127,
        timezone: 'UTC',
        startMinutes: 367,
        endMinutes: 487,
        speed: 3,
        leadMinutes: 60,
      })
      .returning();
    const headers = { authorization: `Bearer ${session.accessToken}` };

    const pause = await app.inject({
      method: 'PATCH',
      url: `/v1/watches/${legacy.id}`,
      headers,
      payload: { enabled: false, version: legacy.version },
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json()).toMatchObject({ startMinutes: 367, endMinutes: 487, enabled: false });

    const invalidEdit = await app.inject({
      method: 'PATCH',
      url: `/v1/watches/${legacy.id}`,
      headers,
      payload: { startMinutes: 368, version: pause.json().version },
    });
    expect(invalidEdit.statusCode).toBe(400);

    const invalidCreate = await app.inject({
      method: 'POST',
      url: '/v1/watches',
      headers,
      payload: {
        routeId,
        weekdays: 127,
        timezone: 'UTC',
        startMinutes: 361,
        endMinutes: 480,
        speed: 3,
        leadMinutes: 60,
        enabled: true,
      },
    });
    expect(invalidCreate.statusCode).toBe(400);
  });

  it('returns seven owner-scoped latest-per-occurrence results and immutable details', async () => {
    const [owner, other] = await db.insert(users).values([{}, {}]).returning();
    const ownerSession = await createSession(owner.id, 'watch-results-owner');
    const otherSession = await createSession(other.id, 'watch-results-other');
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Result history route',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: owner.id,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: 'watch-results-route',
    });
    const [watch] = await db
      .insert(watches)
      .values({
        userId: owner.id,
        routeId,
        weekdays: 127,
        timezone: 'UTC',
        startMinutes: 360,
        endMinutes: 480,
        speed: 2.75,
        leadMinutes: 60,
      })
      .returning();
    const inserted = await db
      .insert(recommendationEvaluations)
      .values(
        Array.from({ length: 9 }, (_unused, index) => {
          const occurrenceDate = `2026-08-${String(index + 1).padStart(2, '0')}`;
          return {
            routeId,
            watchId: watch.id,
            occurrenceDate,
            status: 'no-suitable-window' as const,
            winner: null,
            candidateAssessments: [],
            decisionTime: new Date(`${occurrenceDate}T10:00:00.000Z`),
            windowStart: new Date(`${occurrenceDate}T11:00:00.000Z`),
            windowEnd: new Date(`${occurrenceDate}T13:00:00.000Z`),
            minimumNoticeMs: 60 * 60_000,
            versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
            inputHash: contentIdentity({ watchId: watch.id, occurrenceDate, pass: 1 }),
            planningBundleSnapshot: null,
            expectedFlatSpeedMs: 2.75,
            evaluatedAt: new Date(`${occurrenceDate}T10:00:00.000Z`),
          };
        }),
      )
      .returning();
    const latestDate = '2026-08-09';
    const [latestForDate] = await db
      .insert(recommendationEvaluations)
      .values({
        routeId,
        watchId: watch.id,
        occurrenceDate: latestDate,
        predecessorId: inserted.at(-1)!.id,
        status: 'unavailable',
        winner: null,
        candidateAssessments: [],
        decisionTime: new Date(`${latestDate}T10:15:00.000Z`),
        windowStart: new Date(`${latestDate}T11:00:00.000Z`),
        windowEnd: new Date(`${latestDate}T13:00:00.000Z`),
        minimumNoticeMs: 60 * 60_000,
        versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
        inputHash: contentIdentity({ watchId: watch.id, occurrenceDate: latestDate, pass: 2 }),
        planningBundleSnapshot: null,
        expectedFlatSpeedMs: 2.75,
        evaluatedAt: new Date(`${latestDate}T10:15:00.000Z`),
      })
      .returning();
    await db.insert(notificationPublications).values({
      evaluationId: inserted[7].id,
      watchId: watch.id,
      occurrenceDate: '2026-08-08',
      revision: 1,
      publishedStart: inserted[7].windowStart,
      status: 'no-suitable-window',
      title: 'No suitable start window',
      body: 'Required conditions block this start window.',
      deepLink: `runcast://watch-results/${inserted[7].id}?watch=${watch.id}`,
      data: {},
    });
    await db.update(watches).set({ speed: 4 }).where(eq(watches.id, watch.id));

    const ownerHeaders = { authorization: `Bearer ${ownerSession.accessToken}` };
    const history = await app.inject({
      method: 'GET',
      url: `/v1/watches/${watch.id}/results?limit=7`,
      headers: ownerHeaders,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().results).toHaveLength(7);
    expect(
      history.json().results.map((result: { occurrenceDate: string }) => result.occurrenceDate),
    ).toEqual([
      '2026-08-09',
      '2026-08-08',
      '2026-08-07',
      '2026-08-06',
      '2026-08-05',
      '2026-08-04',
      '2026-08-03',
    ]);
    expect(history.json().results[0]).toMatchObject({
      evaluationId: latestForDate.id,
      status: 'unavailable',
      notificationRevision: 0,
    });
    expect(history.json().results[1]).toMatchObject({ notificationRevision: 1 });

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/watches/${watch.id}/results/${inserted[7].id}`,
      headers: ownerHeaders,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      evaluationId: inserted[7].id,
      watchId: watch.id,
      occurrenceDate: '2026-08-08',
      expectedFlatSpeedMs: 2.75,
      runPlan: null,
      notificationRevision: 1,
    });

    const overLimit = await app.inject({
      method: 'GET',
      url: `/v1/watches/${watch.id}/results?limit=8`,
      headers: ownerHeaders,
    });
    expect(overLimit.statusCode).toBe(400);
    const otherHeaders = { authorization: `Bearer ${otherSession.accessToken}` };
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/watches/${watch.id}/results`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/watches/${watch.id}/results/${inserted[7].id}`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('enforces the per-user watch limit atomically across concurrent creates', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const session = await createSession(user.id, 'watch-limit-device');
    const routeId = randomUUID();
    const route = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>',
      routeId,
      'Watch limit route',
    );
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: 'watch-limit-route',
    });
    await db.insert(watches).values(
      Array.from({ length: 19 }, () => ({
        userId: user.id,
        routeId,
        weekdays: 127,
        timezone: 'UTC',
        startMinutes: 360,
        endMinutes: 480,
        speed: 3,
        leadMinutes: 60,
      })),
    );
    const create = (idempotencyKey: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/watches',
        headers: { authorization: `Bearer ${session.accessToken}` },
        payload: {
          routeId,
          weekdays: 127,
          timezone: 'UTC',
          startMinutes: 360,
          endMinutes: 480,
          speed: 3,
          leadMinutes: 60,
          enabled: true,
          idempotencyKey,
        },
      });
    const responses = await Promise.all([create('watch-limit-a'), create('watch-limit-b')]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json().error.code).toBe(
      'WATCH_LIMIT_REACHED',
    );
    expect(await db.select().from(watches).where(eq(watches.userId, user.id))).toHaveLength(20);
  });

  it('persists new GPX imports as V2 while returning structured topology diagnostics', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const session = await createSession(user.id, 'device-gpx-v2');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        gpx: '<gpx><trk><trkseg><trkpt lat="41" lon="-87"/><trkpt lat="41.01" lon="-87.01"><ele>0</ele></trkpt></trkseg></trk></gpx>',
        name: 'Nullable elevation',
      },
    });
    expect(response.statusCode).toBe(201);
    const [stored] = await db.select().from(routes).where(eq(routes.id, response.json().id));
    expect(stored.canonicalRoute.points.map((point) => point.ele)).toEqual([0, 0]);
    expect(stored.canonicalRouteV2?.part.points.map((point) => point.elevationM)).toEqual([
      null,
      0,
    ]);
    expect(stored.routeQualityV2).toMatchObject({
      elevationStatus: 'partial',
      missingElevationCount: 1,
    });
    expect(stored.v2ContentIdentity).toMatch(/^[a-f0-9]{64}$/);

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        gpx: '<gpx><trk><trkseg><trkpt lat="41" lon="-87"/><trkpt lat="41.01" lon="-87.01"/></trkseg><trkseg><trkpt lat="42" lon="-88"/><trkpt lat="42.01" lon="-88.01"/></trkseg></trk></gpx>',
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error).toMatchObject({
      code: 'INVALID_GPX',
      details: {
        reason: 'MULTIPLE_CONTINUOUS_PARTS',
        diagnostics: [{ code: 'MULTIPLE_CONTINUOUS_PARTS' }],
      },
    });
  });

  it('deduplicates exact route geometry per owner and supports scoped rename and idempotent delete', async () => {
    const [owner, other] = await db.insert(users).values([{}, {}]).returning();
    const ownerSession = await createSession(owner.id, 'device-route-library-owner');
    const otherSession = await createSession(other.id, 'device-route-library-other');
    const gpx =
      '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>1</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
    const firstId = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers: { authorization: `Bearer ${ownerSession.accessToken}` },
      payload: { gpx, name: 'First name', clientRouteId: firstId },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      id: firstId,
      origin: 'cloud-gpx',
      deduplicated: false,
    });
    expect(first.json().geometryIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(first.json().createdAt).toBeTypeOf('string');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers: { authorization: `Bearer ${ownerSession.accessToken}` },
      payload: { gpx, name: 'Duplicate name', clientRouteId: randomUUID() },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ id: firstId, name: 'First name', deduplicated: true });
    expect(await db.select().from(routes).where(eq(routes.ownerId, owner.id))).toHaveLength(1);

    const otherImport = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers: { authorization: `Bearer ${otherSession.accessToken}` },
      payload: { gpx, name: 'Other owner' },
    });
    expect(otherImport.statusCode).toBe(201);
    expect(otherImport.json().id).not.toBe(firstId);

    const foreignRename = await app.inject({
      method: 'PATCH',
      url: `/v1/routes/${firstId}`,
      headers: { authorization: `Bearer ${otherSession.accessToken}` },
      payload: { name: 'Not yours' },
    });
    expect(foreignRename.statusCode).toBe(404);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/routes/${firstId}`,
      headers: { authorization: `Bearer ${ownerSession.accessToken}` },
      payload: { name: '  Morning   loop  ', version: 1 },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Morning loop', version: 2 });
    const bundle = await app.inject({
      method: 'GET',
      url: `/v2/routes/${firstId}`,
      headers: { authorization: `Bearer ${ownerSession.accessToken}` },
    });
    expect(bundle.json().route.data.name).toBe('Morning loop');

    const foreignDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/routes/${firstId}`,
      headers: { authorization: `Bearer ${otherSession.accessToken}` },
    });
    expect(foreignDelete.statusCode).toBe(204);
    expect(await db.select().from(routes).where(eq(routes.id, firstId))).toHaveLength(1);

    for (let attempt = 0; attempt < 2; attempt++) {
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/v1/routes/${firstId}`,
        headers: { authorization: `Bearer ${ownerSession.accessToken}` },
      });
      expect(deleted.statusCode).toBe(204);
    }
    expect(await db.select().from(routes).where(eq(routes.id, firstId))).toEqual([]);
  });

  it('leases V2 forecasts in the database and recovers an expired lease', async () => {
    const [user] = await db.insert(users).values({}).returning();
    const routeId = randomUUID();
    const xml =
      '<gpx><trk><name>Planning</name><trkseg><trkpt lat="41" lon="-87"><ele>0</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
    const legacyRoute = parseGpx(xml, routeId, 'Planning');
    const planningRoute = parsePlanningGpx(xml, routeId, 'Planning');
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: legacyRoute,
      canonicalRouteV2: planningRoute,
      routeQualityV2: planningRoute.quality,
      v2ContentIdentity: contentIdentity(planningRoute),
      name: legacyRoute.name,
      distance: legacyRoute.totalDistance,
      coverageMask: unknownLegacyCoverageMask(legacyRoute),
      coordinateHash: 'planning-v2-route',
    });

    const first = new PostgresRouteForecastRepository();
    const second = new PostgresRouteForecastRepository();
    expect(await first.tryAcquireLease(routeId, 'holder-one', Date.now() + 60_000)).toBe(true);
    expect(await second.tryAcquireLease(routeId, 'holder-two', Date.now() + 60_000)).toBe(false);
    const preparedForecast = preparedRouteForecastFromForecast(planningWeather(Date.now()));
    await expect(
      second.savePreparedForecast(routeId, 'holder-two', preparedForecast),
    ).rejects.toThrow('Forecast preparation lease was lost');
    await first.savePreparedForecast(routeId, 'holder-one', preparedForecast);
    expect((await second.findPreparedForecast(routeId))?.forecast.contentHash).toBe(
      preparedForecast.forecast.contentHash,
    );
    await first.releaseLease(routeId, 'holder-one');

    await db
      .update(routeForecasts)
      .set({ preparationLeaseOwner: 'abandoned', preparationLeaseExpiresAt: new Date(0) })
      .where(eq(routeForecasts.routeId, routeId));
    expect(await second.tryAcquireLease(routeId, 'holder-two', Date.now() + 60_000)).toBe(true);
    await second.releaseLease(routeId, 'holder-two');
  });

  it('refreshes stale watch weather and retries a transient V2 delivery without duplication', async () => {
    const now = new Date('2026-07-18T05:00:00.000Z');
    const [user] = await db.insert(users).values({}).returning();
    const routeId = randomUUID();
    const xml =
      '<gpx><trk><name>Scheduled</name><trkseg><trkpt lat="41" lon="-87"><ele>0</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
    const legacyRoute = parseGpx(xml, routeId, 'Scheduled');
    const planningRoute = parsePlanningGpx(xml, routeId, 'Scheduled');
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: legacyRoute,
      canonicalRouteV2: planningRoute,
      routeQualityV2: planningRoute.quality,
      v2ContentIdentity: contentIdentity(planningRoute),
      name: legacyRoute.name,
      distance: legacyRoute.totalDistance,
      coverageMask: unknownLegacyCoverageMask(legacyRoute),
      coordinateHash: 'scheduled-v2-route',
      timezone: 'UTC',
    });
    const [watch] = await db
      .insert(watches)
      .values({
        userId: user.id,
        routeId,
        weekdays: 64,
        timezone: 'UTC',
        startMinutes: 6 * 60,
        endMinutes: 7 * 60,
        speed: 3,
        leadMinutes: 60,
      })
      .returning();
    await db.insert(deviceInstallations).values({
      userId: user.id,
      deviceId: 'scheduler-v2-device',
      expoPushToken: 'ExponentPushToken[scheduler-v2]',
      platform: 'ios',
      appVersion: '2',
    });
    const repository = new PostgresRouteForecastRepository();
    const staleFetchedAt = now.getTime() - FORECAST_FRESHNESS_MS - 1;
    expect(
      await repository.tryAcquireLease(routeId, 'scheduler-fixture', now.getTime() + 60_000),
    ).toBe(true);
    await repository.savePreparedForecast(
      routeId,
      'scheduler-fixture',
      preparedRouteForecastFromForecast(planningWeather(staleFetchedAt)),
    );
    await repository.releaseLease(routeId, 'scheduler-fixture');
    const refresh = vi
      .spyOn(OpenMeteoRouteForecastPreparer.prototype, 'prepare')
      .mockResolvedValueOnce(preparedRouteForecastFromForecast(planningWeather(now.getTime())));
    expoProvider.send.mockResolvedValueOnce({
      status: 'error',
      message: 'rate limited',
      details: { error: 'MessageRateExceeded' },
    });

    await expect(runScheduler(now)).resolves.toMatchObject({
      acquired: true,
      mode: 'current',
      evaluated: 1,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect((await repository.findPreparedForecast(routeId))?.fetchedAt).toBe(now.getTime());
    const [evaluation] = await db
      .select()
      .from(recommendationEvaluations)
      .where(eq(recommendationEvaluations.watchId, watch.id));
    expect(evaluation).toMatchObject({
      occurrenceDate: '2026-07-18',
      status: 'recommended',
      minimumNoticeMs: 60 * 60_000,
    });
    expect(await db.select().from(notificationPublications)).toHaveLength(1);
    expect(await db.select().from(watchRecommendations)).toEqual([]);
    const [delivery] = await db.select().from(notificationDeliveries);
    expect(delivery).toMatchObject({ ticketState: 'retryable-error', attempts: 1 });
    expect(delivery.payload).toMatchObject({
      schemaVersion: 1,
      type: 'watch-recommendation',
      route: { id: routeId, name: 'Scheduled' },
      watch: { id: watch.id, occurrenceDate: '2026-07-18' },
      delivery: { id: delivery.id },
      snapshot: { engine: 'planning-v2', id: evaluation.id, status: 'recommended' },
    });
    const notificationUrl = new URL(delivery.payload!.url);
    expect(notificationUrl.hostname).toBe('watch-results');
    expect(notificationUrl.pathname).toBe(`/${evaluation.id}`);
    expect(notificationUrl.searchParams.get('watch')).toBe(watch.id);
    expect(notificationUrl.searchParams.has('start')).toBe(false);
    expect(expoProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({ data: delivery.payload }),
    );
    await expect(runScheduler(new Date(now.getTime() + 15 * 60_000))).resolves.toMatchObject({
      acquired: true,
      mode: 'current',
    });
    const deliveriesAfterRetry = await db.select().from(notificationDeliveries);
    expect(deliveriesAfterRetry).toHaveLength(1);
    expect(deliveriesAfterRetry[0]).toMatchObject({
      id: delivery.id,
      publicationId: delivery.publicationId,
      ticketState: 'ok',
      attempts: 2,
    });
    expect(expoProvider.send).toHaveBeenCalledTimes(2);
    await db
      .update(systemHeartbeats)
      .set({ lastSuccessAt: new Date() })
      .where(eq(systemHeartbeats.name, 'watch-scheduler'));
    const cronHealth = await app.inject({ method: 'GET', url: '/health/cron' });
    expect(cronHealth.statusCode).toBe(200);
    expect(cronHealth.json()).toMatchObject({
      status: 'ok',
      schedulerRelease: { sha: 'development', environment: 'local' },
    });
  });

  it('runs the synthetic initial-revision lifecycle and cannot publish a third notification', async () => {
    const originalRevisionMode = config.watchRevisionMode;
    Object.assign(config, { watchRevisionMode: 'active' });
    try {
      const initialTime = new Date('2026-07-18T05:00:00.000Z');
      const [user] = await db.insert(users).values({}).returning();
      const session = await createSession(user.id, 'watch-revision-owner');
      const routeId = randomUUID();
      const xml =
        '<gpx><trk><name>Revision lifecycle</name><trkseg><trkpt lat="41" lon="-87"><ele>0</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
      const legacyRoute = parseGpx(xml, routeId, 'Revision lifecycle');
      const planningRoute = parsePlanningGpx(xml, routeId, 'Revision lifecycle');
      await db.insert(routes).values({
        id: routeId,
        ownerId: user.id,
        source: 'gpx',
        canonicalRoute: legacyRoute,
        canonicalRouteV2: planningRoute,
        routeQualityV2: planningRoute.quality,
        v2ContentIdentity: contentIdentity(planningRoute),
        name: legacyRoute.name,
        distance: legacyRoute.totalDistance,
        coverageMask: unknownLegacyCoverageMask(legacyRoute),
        coordinateHash: 'revision-lifecycle-route',
        timezone: 'UTC',
      });
      const [watch] = await db
        .insert(watches)
        .values({
          userId: user.id,
          routeId,
          weekdays: 64,
          timezone: 'UTC',
          startMinutes: 6 * 60,
          endMinutes: 7 * 60,
          speed: 3,
          leadMinutes: 60,
        })
        .returning();
      await db.insert(deviceInstallations).values([
        {
          userId: user.id,
          deviceId: 'watch-revision-device-one',
          expoPushToken: 'ExponentPushToken[watch-revision-one]',
          platform: 'ios',
          appVersion: '2',
        },
        {
          userId: user.id,
          deviceId: 'watch-revision-device-two',
          expoPushToken: 'ExponentPushToken[watch-revision-two]',
          platform: 'android',
          appVersion: '2',
        },
      ]);
      const repository = new PostgresRouteForecastRepository();
      expect(
        await repository.tryAcquireLease(
          routeId,
          'revision-initial-fixture',
          initialTime.getTime() + 60_000,
        ),
      ).toBe(true);
      await repository.savePreparedForecast(
        routeId,
        'revision-initial-fixture',
        preparedRouteForecastFromForecast(planningWeather(initialTime.getTime())),
      );
      await repository.releaseLease(routeId, 'revision-initial-fixture');

      await expect(runScheduler(initialTime)).resolves.toMatchObject({ evaluated: 1 });
      let publications = await db.select().from(notificationPublications);
      expect(publications).toHaveLength(1);
      expect(publications[0]).toMatchObject({ revision: 1, status: 'recommended' });
      expect(await db.select().from(notificationDeliveries)).toHaveLength(2);

      const changedAt = new Date(initialTime.getTime() + 15 * 60_000);
      expect(
        await repository.tryAcquireLease(
          routeId,
          'revision-change-fixture',
          changedAt.getTime() + 60_000,
        ),
      ).toBe(true);
      await repository.savePreparedForecast(
        routeId,
        'revision-change-fixture',
        preparedRouteForecastFromForecast(
          planningWeather(changedAt.getTime(), { weatherCode: 95 }),
        ),
      );
      await repository.releaseLease(routeId, 'revision-change-fixture');
      expoProvider.receipts.mockResolvedValue({
        'expo-ticket-fixture': { status: 'ok' },
      });

      await expect(runScheduler(changedAt)).resolves.toMatchObject({ evaluated: 1 });
      publications = (await db.select().from(notificationPublications)).sort(
        (left, right) => (left.revision ?? 0) - (right.revision ?? 0),
      );
      expect(publications).toHaveLength(2);
      expect(publications[1]).toMatchObject({
        revision: 2,
        status: 'no-suitable-window',
        supersededPublicationId: publications[0].id,
      });
      expect(publications[1].title).toContain('Conditions changed');
      expect(await db.select().from(notificationDeliveries)).toHaveLength(4);
      expect(expoProvider.send).toHaveBeenCalledTimes(4);

      const exactResult = await app.inject({
        method: 'GET',
        url: `/v1/watches/${watch.id}/results/${publications[1].evaluationId}`,
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(exactResult.statusCode).toBe(200);
      expect(exactResult.json()).toMatchObject({
        evaluationId: publications[1].evaluationId,
        status: 'no-suitable-window',
        notificationRevision: 2,
      });

      await expect(
        runScheduler(new Date(initialTime.getTime() + 30 * 60_000)),
      ).resolves.toMatchObject({ evaluated: 1 });
      expect(await db.select().from(notificationPublications)).toHaveLength(2);
      expect(await db.select().from(notificationDeliveries)).toHaveLength(4);
      expect(expoProvider.send).toHaveBeenCalledTimes(4);
      expect(
        (await db.select().from(notificationDeliveries)).every(
          (delivery) => delivery.receiptState === 'ok',
        ),
      ).toBe(true);
    } finally {
      Object.assign(config, { watchRevisionMode: originalRevisionMode });
    }
  });

  it('skips evaluation before an occurrence enters its lead-time window', async () => {
    const now = new Date('2026-07-18T05:00:00.000Z');
    const [user] = await db.insert(users).values({}).returning();
    const routeId = randomUUID();
    const xml =
      '<gpx><trk><name>Future scheduled</name><trkseg><trkpt lat="41" lon="-87"><ele>0</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
    const legacyRoute = parseGpx(xml, routeId, 'Future scheduled');
    const planningRoute = parsePlanningGpx(xml, routeId, 'Future scheduled');
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: legacyRoute,
      canonicalRouteV2: planningRoute,
      routeQualityV2: planningRoute.quality,
      v2ContentIdentity: contentIdentity(planningRoute),
      name: legacyRoute.name,
      distance: legacyRoute.totalDistance,
      coverageMask: unknownLegacyCoverageMask(legacyRoute),
      coordinateHash: 'future-scheduled-route',
      timezone: 'UTC',
    });
    const [watch] = await db
      .insert(watches)
      .values({
        userId: user.id,
        routeId,
        weekdays: 64,
        timezone: 'UTC',
        startMinutes: 7 * 60,
        endMinutes: 8 * 60,
        speed: 3,
        leadMinutes: 60,
      })
      .returning();
    const repository = new PostgresRouteForecastRepository();
    expect(
      await repository.tryAcquireLease(routeId, 'future-fixture', now.getTime() + 60_000),
    ).toBe(true);
    await repository.savePreparedForecast(
      routeId,
      'future-fixture',
      preparedRouteForecastFromForecast(planningWeather(now.getTime())),
    );
    await repository.releaseLease(routeId, 'future-fixture');
    await db
      .update(routeForecasts)
      .set({
        weather: legacyPlanningWeather(now.getTime()),
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 4 * 60 * 60_000),
      })
      .where(eq(routeForecasts.routeId, routeId));

    await expect(runScheduler(now)).resolves.toMatchObject({ evaluated: 0 });
    expect(
      await db
        .select()
        .from(recommendationEvaluations)
        .where(eq(recommendationEvaluations.watchId, watch.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(watchRecommendations)
        .where(eq(watchRecommendations.watchId, watch.id)),
    ).toEqual([]);
  });

  it('keeps exact V2 evaluations, publications, and delivery references immutable', async () => {
    const now = Date.now();
    const [user] = await db.insert(users).values({}).returning();
    const routeId = randomUUID();
    const xml =
      '<gpx><trk><name>Immutable</name><trkseg><trkpt lat="41" lon="-87"><ele>0</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
    const legacyRoute = parseGpx(xml, routeId, 'Immutable');
    const planningRoute = parsePlanningGpx(xml, routeId, 'Immutable');
    await db.insert(routes).values({
      id: routeId,
      ownerId: user.id,
      source: 'gpx',
      canonicalRoute: legacyRoute,
      canonicalRouteV2: planningRoute,
      routeQualityV2: planningRoute.quality,
      v2ContentIdentity: contentIdentity(planningRoute),
      name: legacyRoute.name,
      distance: legacyRoute.totalDistance,
      coverageMask: unknownLegacyCoverageMask(legacyRoute),
      coordinateHash: 'immutable-route',
    });
    const [watch] = await db
      .insert(watches)
      .values({
        userId: user.id,
        routeId,
        weekdays: 127,
        timezone: 'UTC',
        startMinutes: 360,
        endMinutes: 480,
        speed: 3,
        leadMinutes: 60,
      })
      .returning();
    const weather = planningWeather(now);
    const bundle = assemblePlanningBundleV2({
      route: {
        id: routeId,
        route: legacyRoute,
        planningRoute,
        coverage: unknownLegacyCoverageMask(legacyRoute),
      },
      preparedForecast: preparedRouteForecastFromForecast(weather),
      evaluatorBuild: 'integration-fixture',
      now,
    }) as PlanningBundleV2;
    const recommendation = historicalRecommendation(now, bundle.manifest.bundleId);
    const evaluationInput = {
      routeId,
      watchId: watch.id,
      occurrenceDate: '2026-07-18',
      recommendation,
      decisionTime: now,
      windowStart: now,
      windowEnd: now + 30 * 60_000,
      minimumNoticeMs: 0,
      bundle,
    };
    const evaluation = await appendRecommendationEvaluation(evaluationInput);
    const retry = await appendRecommendationEvaluation(evaluationInput);
    expect(retry.id).toBe(evaluation.id);
    expect(await db.select().from(recommendationEvaluations)).toHaveLength(1);

    const publication = await appendNotificationPublication({
      evaluationId: evaluation.id,
      status: recommendation.status as 'recommended',
      title: 'Best time for Immutable',
      body: '06:00 · Your route forecast is ready.',
      deepLink: `runcast://routes/${routeId}?evaluation=${evaluation.id}`,
      data: { routeId, evaluationId: evaluation.id },
    });
    expect(
      (
        await appendNotificationPublication({
          evaluationId: evaluation.id,
          status: 'recommended',
          title: 'Ignored retry copy',
          body: 'Ignored retry body',
          deepLink: 'runcast://ignored',
          data: {},
        })
      ).id,
    ).toBe(publication.id);

    const [device] = await db
      .insert(deviceInstallations)
      .values({
        userId: user.id,
        deviceId: 'immutable-device',
        expoPushToken: 'ExponentPushToken[immutable]',
        platform: 'ios',
        appVersion: '2',
      })
      .returning();
    const [legacyRecommendation] = await db
      .insert(watchRecommendations)
      .values({
        watchId: watch.id,
        occurrenceDate: '2026-07-18',
        bestStart: new Date(now),
        summary: {},
        engineVersion: 'legacy-fixture',
      })
      .returning();
    const [delivery] = await db
      .insert(notificationDeliveries)
      .values({
        watchId: watch.id,
        occurrenceDate: '2026-07-18',
        deviceId: device.id,
        recommendationId: legacyRecommendation.id,
        publicationId: publication.id,
      })
      .returning();
    await db
      .update(notificationDeliveries)
      .set({ ticketState: 'ok', attempts: 1 })
      .where(eq(notificationDeliveries.id, delivery.id));
    await expect(
      db
        .update(notificationDeliveries)
        .set({ publicationId: null })
        .where(eq(notificationDeliveries.id, delivery.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      db
        .update(notificationDeliveries)
        .set({ recommendationId: null })
        .where(eq(notificationDeliveries.id, delivery.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      db
        .update(recommendationEvaluations)
        .set({ status: 'caution' })
        .where(eq(recommendationEvaluations.id, evaluation.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      db.delete(notificationPublications).where(eq(notificationPublications.id, publication.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });

    // The exception for an initiating account deletion is deliberate: all
    // immutable snapshots are still user-owned data and cascade together.
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(recommendationEvaluations)).toEqual([]);
    expect(await db.select().from(notificationPublications)).toEqual([]);
    expect(await db.select().from(notificationDeliveries)).toEqual([]);
  });
});
