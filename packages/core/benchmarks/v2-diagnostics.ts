import { cpus, platform, release, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { assemblePlanningBundleV2 } from '../../../apps/api/src/planning/bundle';
import {
  promotePlanningBundle,
  type PlanningBundleCacheRow,
  type PlanningBundleRowStore,
} from '../../../apps/mobile/src/data/planningBundle';
import {
  cumulativeDistances,
  evaluateRunV3,
  normalizeOpenMeteoForecast,
  recommendStartV3,
  type WoodlandEvidenceProfile,
  type LegacyCoverageMask,
  type PlanningRoute,
  type RawOpenMeteoLocation,
  type LegacyRoute,
} from '../src/index';

const HOUR_MS = 3_600_000;
const BENCHMARK_T0 = Date.UTC(2026, 6, 18, 12);
const EXPECTED_FLAT_SPEED_MS = 3.03;

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
}

interface BenchmarkResult extends Percentiles {
  name: string;
  iterations: number;
  unit: 'ms';
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.max(Math.ceil(sorted.length * quantile) - 1, 0)];
}

function summarize(name: string, samples: number[]): BenchmarkResult {
  samples.sort((left, right) => left - right);
  return {
    name,
    iterations: samples.length,
    unit: 'ms',
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

function measureSync(
  name: string,
  warmup: number,
  iterations: number,
  operation: () => unknown,
): BenchmarkResult {
  for (let index = 0; index < warmup; index += 1) operation();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  return summarize(name, samples);
}

async function measureAsync(
  name: string,
  warmup: number,
  iterations: number,
  operation: () => Promise<unknown>,
): Promise<BenchmarkResult> {
  for (let index = 0; index < warmup; index += 1) await operation();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  return summarize(name, samples);
}

function routeFixture(): { planningRoute: PlanningRoute; legacyRoute: LegacyRoute } {
  const points = Array.from({ length: 101 }, (_, index) => ({
    lat: 41.88 + index * 0.00002,
    lon: -87.67 + index * 0.0012,
    elevationM: 180 + Math.sin(index / 8) * 8,
  }));
  const cumulativeDistanceM = cumulativeDistances(points);
  const totalDistanceM = cumulativeDistanceM.at(-1)!;
  const planningRoute: PlanningRoute = {
    schemaVersion: 2,
    id: 'benchmark-route-10k',
    name: 'Benchmark route',
    part: { points },
    cumulativeDistanceM,
    totalDistanceM,
    quality: {
      schemaVersion: 2,
      trackCount: 1,
      trackSegmentCount: 1,
      routeCount: 0,
      invalidPointCount: 0,
      duplicatePointCount: 0,
      missingElevationCount: 0,
      elevationStatus: 'complete',
      reasons: [],
    },
  };
  return {
    planningRoute,
    legacyRoute: {
      id: planningRoute.id,
      name: planningRoute.name,
      points: points.map((point) => ({ ...point, ele: point.elevationM })),
      cumulative: cumulativeDistanceM,
      totalDistance: totalDistanceM,
    },
  };
}

function rawWeather(lat: number, lon: number, phase: number): RawOpenMeteoLocation {
  const hours = Array.from({ length: 72 }, (_, index) => index);
  const wave = (index: number) => Math.sin((index + phase) / 6);
  return {
    latitude: lat,
    longitude: lon,
    timezone: 'America/Chicago',
    utc_offset_seconds: -18_000,
    hourly_units: {
      time: 'iso8601',
      temperature_2m: '°C',
      apparent_temperature: '°C',
      relative_humidity_2m: '%',
      wind_speed_10m: 'm/s',
      wind_direction_10m: '°',
      wind_gusts_10m: 'm/s',
      cloud_cover: '%',
      precipitation_probability: '%',
      precipitation: 'mm',
      weather_code: 'wmo code',
      shortwave_radiation: 'W/m²',
      direct_normal_irradiance: 'W/m²',
      diffuse_radiation: 'W/m²',
    },
    hourly: {
      time: hours.map((hour) => new Date(BENCHMARK_T0 + hour * HOUR_MS).toISOString()),
      temperature_2m: hours.map((hour) => 19 + wave(hour) * 4),
      apparent_temperature: hours.map((hour) => 19 + wave(hour) * 4.5),
      relative_humidity_2m: hours.map((hour) => 55 - wave(hour) * 8),
      wind_speed_10m: hours.map((hour) => 3 + Math.abs(wave(hour))),
      wind_direction_10m: hours.map((hour) => (210 + hour * 3 + phase) % 360),
      wind_gusts_10m: hours.map((hour) => 6 + Math.abs(wave(hour)) * 2),
      cloud_cover: hours.map((hour) => 30 + wave(hour) * 15),
      precipitation_probability: hours.map(() => 10),
      precipitation: hours.map(() => 0.1),
      weather_code: hours.map(() => 1),
      shortwave_radiation: hours.map((hour) =>
        Math.max(0, Math.sin(((hour % 24) / 24) * Math.PI) * 600),
      ),
      direct_normal_irradiance: hours.map((hour) =>
        Math.max(0, Math.sin(((hour % 24) / 24) * Math.PI) * 500),
      ),
      diffuse_radiation: hours.map((hour) =>
        Math.max(0, Math.sin(((hour % 24) / 24) * Math.PI) * 120),
      ),
    },
  };
}

class MemoryPlanningBundleStore implements PlanningBundleRowStore {
  row: PlanningBundleCacheRow | null = null;

  async replace(row: PlanningBundleCacheRow): Promise<void> {
    this.row = row;
  }

  async read(): Promise<PlanningBundleCacheRow | null> {
    return this.row;
  }
}

async function main(): Promise<void> {
  const { planningRoute, legacyRoute } = routeFixture();
  const finalPoint = planningRoute.part.points.at(-1)!;
  const forecast = normalizeOpenMeteoForecast(
    [
      rawWeather(planningRoute.part.points[0].lat, planningRoute.part.points[0].lon, 0),
      rawWeather(finalPoint.lat, finalPoint.lon, 2),
    ],
    [
      { ...planningRoute.part.points[0], routeDistanceM: 0 },
      { ...finalPoint, routeDistanceM: planningRoute.totalDistanceM },
    ],
    { fetchId: 'diagnostic-benchmark', fetchedAt: BENCHMARK_T0 },
  );
  const woodlandEvidence: WoodlandEvidenceProfile = {
    schemaVersion: 2,
    values: Array.from({ length: Math.floor(planningRoute.totalDistanceM / 50) + 1 }, (_, index) =>
      index % 5 === 0 ? 'mapped-woodland' : 'no-mapped-woodland',
    ),
    resolutionM: 50,
    source: 'diagnostic-fixture',
    fetchedAt: BENCHMARK_T0,
    parserVersion: 'diagnostic-fixture-v2',
    completeness: 'complete',
    confidence: 1,
    reasons: [],
  };
  const startTime = BENCHMARK_T0 + HOUR_MS;
  const evaluate = (at: number) =>
    evaluateRunV3({
      route: planningRoute,
      forecast,
      woodlandEvidence,
      startTime: at,
      expectedFlatSpeedMs: EXPECTED_FLAT_SPEED_MS,
    });

  const cachedPlan = measureSync('cached-plan-evaluate', 50, 400, () => evaluate(startTime));
  const fullScan = measureSync('full-24h-recommendation-scan', 5, 50, () =>
    recommendStartV3({
      windowStart: startTime,
      windowEnd: startTime + 24 * HOUR_MS,
      decisionTime: startTime,
      minimumNoticeMs: 0,
      validFrom: forecast.validFrom,
      validUntil: forecast.validUntil,
      inputIdentity: { routeId: planningRoute.id, forecast: forecast.contentHash },
      evaluate,
    }),
  );

  const legacyCoverage: LegacyCoverageMask = {
    resolution: woodlandEvidence.resolutionM,
    values: woodlandEvidence.values.map((value) => (value === 'mapped-woodland' ? 'tree' : 'open')),
  };
  const bundle = assemblePlanningBundleV2({
    route: {
      id: planningRoute.id,
      route: legacyRoute,
      planningRoute: planningRoute,
      coverage: legacyCoverage,
    },
    preparedForecast: {
      forecast,
      timezone: 'America/Chicago',
      fetchedAt: BENCHMARK_T0,
      validFrom: forecast.validFrom,
      validUntil: forecast.validUntil,
    },
    evaluatorBuild: 'diagnostic-benchmark',
    now: startTime,
  });
  const body = JSON.stringify(bundle);
  const store = new MemoryPlanningBundleStore();
  const bundlePromotion = await measureAsync('bundle-parse-hash-memory-promotion', 20, 200, () =>
    promotePlanningBundle(store, {
      userId: 'benchmark-user',
      routeId: planningRoute.id,
      etag: `"${bundle.manifest.bundleId}"`,
      body,
      now: BENCHMARK_T0,
    }),
  );

  const output = {
    diagnosticOnly: true,
    thresholdsEnforced: false,
    measuredAt: new Date().toISOString(),
    host: {
      node: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
    },
    fixture: {
      routePoints: planningRoute.part.points.length,
      routeDistanceM: planningRoute.totalDistanceM,
      timingMeshMaximum: 201,
      recommendationCandidates: 49,
      forecastAnchors: forecast.anchors.length,
      forecastHours: forecast.anchors[0].hourly.time.length,
      bundleBytesUtf8: new TextEncoder().encode(body).byteLength,
      promotionStore: 'in-memory PlanningBundleRowStore (not SQLite)',
    },
    results: [cachedPlan, fullScan, bundlePromotion],
    unmeasured: [
      'provider acquisition',
      'cached bundle HTTP API and ETag/304',
      'scheduler batch',
      'SQLite promotion',
      'physical mobile device',
      'iOS simulator',
      'actual browser runtime',
      'actual Hermes runtime',
    ],
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

await main();
