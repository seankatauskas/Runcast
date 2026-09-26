import { randomUUID } from 'node:crypto';
import { contentIdentity, parseGpx, unknownLegacyCoverageMask } from '@runcast/core';
import { routeDescriptorSchema } from '@runcast/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { createSession } from '../session';
import { OpenMeteoRouteForecastPreparer } from '../planning/runtime';
import { closeDatabase, db } from './client';
import { users, routes, routeForecasts } from './schema';

const integration = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;
const owners: string[] = [];
const gpx =
  '<gpx><trk><trkseg><trkpt lat="41" lon="-87"/><trkpt lat="41.01" lon="-87.01"><ele>1</ele></trkpt></trkseg></trk></gpx>';
integration('forecast-independent current route descriptors', () => {
  let app: FastifyInstance;
  let ownerId: string;
  let headers: { authorization: string };
  beforeAll(async () => {
    app = await buildApp();
  });
  beforeEach(async () => {
    const [owner] = await db.insert(users).values({}).returning();
    ownerId = owner.id;
    owners.push(ownerId);
    const session = await createSession(ownerId, randomUUID());
    headers = { authorization: `Bearer ${session.accessToken}` };
    vi.spyOn(OpenMeteoRouteForecastPreparer.prototype, 'prepare').mockRejectedValue(
      new Error('forecast provider offline'),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (owners.length) await db.delete(users).where(inArray(users.id, owners.splice(0)));
  });
  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it('serves imported geometry and metadata without fetching weather, preserving route identity and elevation evidence', async () => {
    const imported = await app.inject({
      method: 'POST',
      url: '/v1/routes/gpx',
      headers,
      payload: { gpx, idempotencyKey: randomUUID() },
    });
    expect(imported.statusCode).toBe(201);
    const id = imported.json().id;
    const response = await app.inject({ method: 'GET', url: `/v2/routes/${id}`, headers });
    expect(response.statusCode).toBe(200);
    const descriptor = routeDescriptorSchema.parse(response.json());
    expect(descriptor.summary.id).toBe(id);
    expect(descriptor.route.data.quality.elevationStatus).toBe('partial');
    expect(descriptor.route.data.part.points[0].elevationM).toBeNull();
    expect(descriptor.route.contentHash).toBe(contentIdentity({ data: descriptor.route.data }));
    expect(descriptor.woodlandEvidence.completeness).toBe('unknown');
    expect(
      await db.select().from(routeForecasts).where(eq(routeForecasts.routeId, id)),
    ).toHaveLength(0);
    expect(OpenMeteoRouteForecastPreparer.prototype.prepare).not.toHaveBeenCalled();
    const retired = await app.inject({ method: 'GET', url: `/v1/routes/${id}/bundle`, headers });
    expect(retired.statusCode).toBe(426);
    expect(retired.json().error.code).toBe('CLIENT_UPDATE_REQUIRED');
  });

  it('adapts stored legacy geometry conservatively and enforces ownership on both routes', async () => {
    const id = randomUUID();
    const route = parseGpx(gpx, id, 'Historical route');
    await db.insert(routes).values({
      id,
      ownerId,
      source: 'gpx',
      canonicalRoute: route,
      name: route.name,
      distance: route.totalDistance,
      coverageMask: unknownLegacyCoverageMask(route),
      coordinateHash: randomUUID(),
    });
    const response = await app.inject({ method: 'GET', url: `/v2/routes/${id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().route.data.quality.elevationStatus).toBe('legacy-unknown');
    const [other] = await db.insert(users).values({}).returning();
    owners.push(other.id);
    const session = await createSession(other.id, randomUUID());
    for (const url of [`/v2/routes/${id}`, `/v1/routes/${id}/bundle`]) {
      const forbidden = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(forbidden.statusCode).toBe(404);
    }
    expect(OpenMeteoRouteForecastPreparer.prototype.prepare).not.toHaveBeenCalled();
  });
});
