import { randomUUID } from 'node:crypto';
import type { PlanningBundleV2 } from '@runcast/contracts';
import {
  PLANNING_ALGORITHM_VERSION_MANIFEST,
  contentIdentity,
  parseGpx,
  parsePlanningGpx,
  unknownLegacyCoverageMask,
  type NormalizedRouteForecast,
  type ForecastVariable,
} from '@runcast/core';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { preparedRouteForecastFromForecast } from '../planning/bundle';
import {
  assemblePlanningBundleV2,
  historicalRecommendation,
} from './fixtures/historicalPlanningBundle';
import { appendRecommendationEvaluation } from '../planning/evaluations';
import { measureEvaluationStorage, pruneEvaluationStorage } from '../planning/evaluationStorage';
import { closeDatabase, db } from './client';
import { buildApp } from '../app';
import { createSession } from '../session';
import {
  notificationPublications,
  planningBundleArtifacts,
  recommendationEvaluations,
  routes,
  users,
  watches,
} from './schema';

const integration = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;
const ownerIds: string[] = [];
const NOW = new Date();
const OLD = new Date(NOW.getTime() - 60 * 86_400_000);
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

async function fixture() {
  const [owner] = await db.insert(users).values({}).returning();
  ownerIds.push(owner.id);
  const routeId = randomUUID();
  const xml =
    '<gpx><trk><trkseg><trkpt lat="41" lon="-87"><ele>0</ele></trkpt><trkpt lat="41.01" lon="-87.01"><ele>2</ele></trkpt></trkseg></trk></gpx>';
  const legacyRoute = parseGpx(xml, routeId, 'Storage route');
  const planningRoute = parsePlanningGpx(xml, routeId, 'Storage route');
  await db.insert(routes).values({
    id: routeId,
    ownerId: owner.id,
    source: 'gpx',
    canonicalRoute: legacyRoute,
    canonicalRouteV2: planningRoute,
    name: legacyRoute.name,
    distance: legacyRoute.totalDistance,
    coverageMask: unknownLegacyCoverageMask(legacyRoute),
    coordinateHash: randomUUID(),
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
      speed: 3,
      leadMinutes: 60,
    })
    .returning();
  const now = NOW.getTime();
  const weather = planningWeather(now);
  const bundle = assemblePlanningBundleV2({
    route: {
      id: routeId,
      route: legacyRoute,
      planningRoute,
      coverage: unknownLegacyCoverageMask(legacyRoute),
    },
    preparedForecast: preparedRouteForecastFromForecast(weather),
    evaluatorBuild: 'storage-fixture',
    now,
  }) as PlanningBundleV2;
  const recommendation = historicalRecommendation(now, bundle.manifest.bundleId);
  const input = {
    routeId,
    watchId: watch.id,
    occurrenceDate: NOW.toISOString().slice(0, 10),
    recommendation,
    decisionTime: now,
    windowStart: now,
    windowEnd: now + 30 * 60_000,
    minimumNoticeMs: 0,
    bundle,
  };
  return { owner, routeId, watch, bundle, input };
}

async function evaluation(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    predecessorId?: string;
    planningBundleId?: string;
    recent?: boolean;
    futureWindow?: boolean;
    inline?: boolean;
  } = {},
  executor: Pick<typeof db, 'insert'> = db,
) {
  const [row] = await executor
    .insert(recommendationEvaluations)
    .values({
      routeId: f.routeId,
      watchId: f.watch.id,
      occurrenceDate: OLD.toISOString().slice(0, 10),
      predecessorId: options.predecessorId,
      status: 'no-suitable-window',
      winner: null,
      candidateAssessments: [],
      decisionTime: OLD,
      windowStart: OLD,
      windowEnd: options.futureWindow ? new Date(NOW.getTime() + 86_400_000) : OLD,
      minimumNoticeMs: 0,
      versions: PLANNING_ALGORITHM_VERSION_MANIFEST,
      inputHash: randomUUID(),
      planningBundleId: options.planningBundleId,
      planningBundleSnapshot: options.inline ? f.bundle : null,
      evaluatedAt: options.recent ? NOW : OLD,
    })
    .returning();
  return row;
}

async function artifact(f: Awaited<ReturnType<typeof fixture>>) {
  const [row] = await db
    .insert(planningBundleArtifacts)
    .values({
      routeId: f.routeId,
      contentHash: contentIdentity(f.bundle),
      snapshot: f.bundle,
      createdAt: OLD,
    })
    .returning();
  return row;
}

async function publication(evaluationId: string, supersededPublicationId?: string) {
  const [row] = await db
    .insert(notificationPublications)
    .values({
      evaluationId,
      status: 'no-suitable-window',
      title: 'Immutable',
      body: 'Stored result',
      deepLink: 'runcast://result',
      data: {},
      supersededPublicationId,
    })
    .returning();
  return row;
}

async function storedSnapshots(ids: string[]) {
  const rows = await db
    .select({ evaluation: recommendationEvaluations, artifact: planningBundleArtifacts })
    .from(recommendationEvaluations)
    .leftJoin(
      planningBundleArtifacts,
      eq(planningBundleArtifacts.id, recommendationEvaluations.planningBundleId),
    )
    .where(inArray(recommendationEvaluations.id, ids));
  return rows.map(({ evaluation, artifact }) => ({
    ...evaluation,
    planningBundleSnapshot: evaluation.planningBundleSnapshot ?? artifact?.snapshot ?? null,
  }));
}

integration('evaluation storage deduplication and retention', () => {
  afterEach(async () => {
    if (ownerIds.length) await db.delete(users).where(inArray(users.id, ownerIds.splice(0)));
  });
  afterAll(closeDatabase);

  it('shares exact bundles across concurrent evaluations without changing input identity or replay', async () => {
    const f = await fixture();
    const inputs = [f.input, { ...f.input, decisionTime: f.input.decisionTime + 1 }];
    const stored = await Promise.all(inputs.map(appendRecommendationEvaluation));
    expect(stored[0].id).not.toBe(stored[1].id);
    expect(stored[0].planningBundleId).toBe(stored[1].planningBundleId);
    expect(stored[0].planningBundleSnapshot).toEqual(f.bundle);
    const expectedHash = contentIdentity({
      recommendationInputHash: f.input.recommendation.inputHash,
      planningBundleSnapshotHash: contentIdentity(f.bundle),
      routeId: f.routeId,
      watchId: f.watch.id,
      occurrenceDate: f.input.occurrenceDate,
      decisionTime: f.input.decisionTime,
      windowStart: f.input.windowStart,
      windowEnd: f.input.windowEnd,
      minimumNoticeMs: 0,
      expectedFlatSpeedMs: null,
    });
    expect(stored[0].inputHash).toBe(expectedHash);
    expect((await appendRecommendationEvaluation(f.input)).id).toBe(stored[0].id);
    const rows = await db
      .select()
      .from(recommendationEvaluations)
      .where(eq(recommendationEvaluations.routeId, f.routeId));
    expect(rows.every((row) => row.planningBundleSnapshot === null)).toBe(true);
    expect(
      await db
        .select()
        .from(planningBundleArtifacts)
        .where(eq(planningBundleArtifacts.routeId, f.routeId)),
    ).toHaveLength(1);
    expect(
      (await storedSnapshots(rows.map((row) => row.id))).map((row) => row.planningBundleSnapshot),
    ).toEqual([f.bundle, f.bundle]);
  });

  it('hydrates legacy inline snapshots without rewriting immutable evaluations', async () => {
    const f = await fixture();
    const row = await evaluation(f, { inline: true });
    expect((await storedSnapshots([row.id]))[0].planningBundleSnapshot).toEqual(f.bundle);
    expect(
      await db
        .select()
        .from(planningBundleArtifacts)
        .where(eq(planningBundleArtifacts.routeId, f.routeId)),
    ).toHaveLength(0);
    await expect(
      db
        .update(recommendationEvaluations)
        .set({ planningBundleSnapshot: null })
        .where(eq(recommendationEvaluations.id, row.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
  });

  it('removes an old unpublished predecessor chain and its unreferenced artifact within a bounded pass', async () => {
    const f = await fixture();
    const bundle = await artifact(f);
    let previous: string | undefined;
    for (let index = 0; index < 3; index += 1) {
      previous = (await evaluation(f, { predecessorId: previous, planningBundleId: bundle.id })).id;
    }
    const first = await pruneEvaluationStorage({ now: NOW, batchSize: 2 });
    expect(first.evaluationsDeleted).toBe(2);
    expect(first.artifactsDeleted).toBe(0);
    expect(
      await db
        .select()
        .from(recommendationEvaluations)
        .where(eq(recommendationEvaluations.routeId, f.routeId)),
    ).toHaveLength(1);
    const second = await pruneEvaluationStorage({ now: NOW, batchSize: 2 });
    expect(second.evaluationsDeleted).toBe(1);
    expect(second.artifactsDeleted).toBe(1);
  });

  it('preserves published evaluations, ancestors, referenced artifacts, recent history, and open windows', async () => {
    const f = await fixture();
    const bundle = await artifact(f);
    const ancestor = await evaluation(f, { planningBundleId: bundle.id });
    const published = await evaluation(f, {
      predecessorId: ancestor.id,
      planningBundleId: bundle.id,
    });
    await publication(published.id);
    const recent = await evaluation(f, { recent: true });
    const future = await evaluation(f, { futureWindow: true });
    await evaluation(f);
    const result = await pruneEvaluationStorage({ now: NOW });
    expect(result.evaluationsDeleted).toBe(1);
    expect(result.artifactsDeleted).toBe(0);
    const rows = await db
      .select()
      .from(recommendationEvaluations)
      .where(eq(recommendationEvaluations.routeId, f.routeId));
    expect(rows.map((row) => row.id).sort()).toEqual(
      [ancestor.id, published.id, recent.id, future.id].sort(),
    );
  });

  it('rejects arbitrary snapshot mutation and retains account deletion cascades through references', async () => {
    const f = await fixture();
    const bundle = await artifact(f);
    const ancestor = await evaluation(f, { planningBundleId: bundle.id });
    const child = await evaluation(f, { predecessorId: ancestor.id, planningBundleId: bundle.id });
    const firstPublication = await publication(ancestor.id);
    await publication(child.id, firstPublication.id);
    await expect(
      db.delete(recommendationEvaluations).where(eq(recommendationEvaluations.id, child.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      db
        .update(planningBundleArtifacts)
        .set({ contentHash: 'tampered' })
        .where(eq(planningBundleArtifacts.id, bundle.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      db.delete(planningBundleArtifacts).where(eq(planningBundleArtifacts.id, bundle.id)),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await db.delete(users).where(eq(users.id, f.owner.id));
    expect(
      await db
        .select()
        .from(recommendationEvaluations)
        .where(eq(recommendationEvaluations.routeId, f.routeId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(planningBundleArtifacts)
        .where(eq(planningBundleArtifacts.routeId, f.routeId)),
    ).toHaveLength(0);
  });

  it('measures stored artifact bytes and deduplication savings without changing data', async () => {
    const f = await fixture();
    await appendRecommendationEvaluation(f.input);
    await appendRecommendationEvaluation({ ...f.input, decisionTime: f.input.decisionTime + 1 });
    const measurement = await measureEvaluationStorage();
    expect(measurement.estimatedSnapshotBytesAvoided).toBeGreaterThan(0);
    expect(measurement.totalRelationBytes).toBeGreaterThan(0);
    expect(measurement.artifactReferenceCount).toBeGreaterThanOrEqual(2);
    const [fixtureBytes] = await db.execute<{ bytes: number }>(sql`
      SELECT pg_column_size(snapshot)::float8 AS bytes FROM planning_bundle_artifacts WHERE route_id = ${f.routeId}
    `);
    console.info(
      JSON.stringify({
        event: 'storage.synthetic-fixture',
        evaluations: 2,
        bundleArtifacts: 1,
        repeatedSnapshotBytes: fixtureBytes.bytes * 2,
        deduplicatedSnapshotBytes: fixtureBytes.bytes,
        snapshotBytesAvoided: fixtureBytes.bytes,
      }),
    );
  });

  it('safely reuses an old artifact while retention attempts collection', async () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const f = await fixture();
      await artifact(f);
      const [stored] = await Promise.all([
        appendRecommendationEvaluation(f.input),
        pruneEvaluationStorage({ now: NOW }),
      ]);
      const [loaded] = await storedSnapshots([stored.id]);
      expect(loaded.planningBundleSnapshot).toEqual(f.bundle);
      expect(
        await db
          .select()
          .from(planningBundleArtifacts)
          .where(eq(planningBundleArtifacts.routeId, f.routeId)),
      ).toHaveLength(1);
    }
  });

  it('skips an artifact pinned by a writer and preserves the committed reference', async () => {
    const f = await fixture();
    const bundle = await artifact(f);
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseWriter!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writer = db.transaction(async (tx) => {
      await tx
        .select()
        .from(planningBundleArtifacts)
        .where(eq(planningBundleArtifacts.id, bundle.id))
        .for('key share');
      signalLocked();
      await released;
      return evaluation(f, { planningBundleId: bundle.id, recent: true }, tx);
    });
    try {
      await Promise.race([locked, writer]);
      expect((await pruneEvaluationStorage({ now: NOW })).artifactsDeleted).toBe(0);
    } finally {
      releaseWriter();
      await writer;
    }
    const stored = await writer;
    expect((await pruneEvaluationStorage({ now: NOW })).artifactsDeleted).toBe(0);
    expect((await storedSnapshots([stored.id]))[0].planningBundleSnapshot).toEqual(f.bundle);
  });

  it('keeps the public history detail coherent while old evaluations are collected', async () => {
    const f = await fixture();
    const bundle = await artifact(f);
    const old = await evaluation(f, { planningBundleId: bundle.id });
    const session = await createSession(f.owner.id, randomUUID());
    const app = await buildApp();
    try {
      const headers = { authorization: `Bearer ${session.accessToken}` };
      const request = {
        method: 'GET' as const,
        url: `/v1/watches/${f.watch.id}/results/${old.id}`,
        headers,
      };
      const [read] = await Promise.all([app.inject(request), pruneEvaluationStorage({ now: NOW })]);
      expect([200, 404]).toContain(read.statusCode);
      if (read.statusCode === 200) {
        expect(read.json().forecastFetchedAt).toBe(
          new Date(f.bundle.forecast.data.fetchedAt).toISOString(),
        );
      }
      expect((await app.inject(request)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('serves deduplicated snapshot metadata through both watch history readers', async () => {
    const f = await fixture();
    const stored = await appendRecommendationEvaluation(f.input);
    const session = await createSession(f.owner.id, randomUUID());
    const app = await buildApp();
    try {
      const headers = { authorization: `Bearer ${session.accessToken}` };
      const detail = await app.inject({
        method: 'GET',
        url: `/v1/watches/${f.watch.id}/results/${stored.id}`,
        headers,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().forecastFetchedAt).toBe(
        new Date(f.bundle.forecast.data.fetchedAt).toISOString(),
      );
      const history = await app.inject({
        method: 'GET',
        url: `/v1/watches/${f.watch.id}/results`,
        headers,
      });
      expect(history.statusCode).toBe(200);
      expect(history.json().results[0].forecastFetchedAt).toBe(detail.json().forecastFetchedAt);
    } finally {
      await app.close();
    }
  });

  it('rejects retention policies below seven days or unbounded batches', async () => {
    await expect(pruneEvaluationStorage({ retentionDays: 0 })).rejects.toThrow(RangeError);
    await expect(pruneEvaluationStorage({ batchSize: 5001 })).rejects.toThrow(RangeError);
  });
});
