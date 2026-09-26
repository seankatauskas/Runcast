import { performance } from 'node:perf_hooks';

export interface PlanningHttpBenchmarkConfig {
  baseUrl: string;
  routeId: string;
  authorization: string;
  evaluatorBuild: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function planningHttpConfig(): PlanningHttpBenchmarkConfig {
  const token = required('RUNCAST_BENCH_ACCESS_TOKEN');
  return {
    baseUrl: required('RUNCAST_BENCH_BASE_URL').replace(/\/$/, ''),
    routeId: required('RUNCAST_BENCH_ROUTE_ID'),
    authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    evaluatorBuild: process.env.RUNCAST_BENCH_EVALUATOR_BUILD?.trim() || 'diagnostic-benchmark',
  };
}

export async function bundleRequest(
  config: PlanningHttpBenchmarkConfig,
  etag?: string,
): Promise<{ response: Response; elapsedMs: number }> {
  const started = performance.now();
  const response = await fetch(
    `${config.baseUrl}/v2/routes/${encodeURIComponent(config.routeId)}/planning-bundle`,
    {
      headers: {
        authorization: config.authorization,
        'x-runcast-bundle-reader': '3',
        'x-runcast-evaluator-build': config.evaluatorBuild,
        ...(etag ? { 'if-none-match': etag } : {}),
      },
    },
  );
  await response.arrayBuffer();
  return { response, elapsedMs: performance.now() - started };
}

export function percentiles(samples: number[]): { p50: number; p95: number; p99: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (quantile: number) => sorted[Math.max(Math.ceil(sorted.length * quantile) - 1, 0)];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}
