import { pathToFileURL } from 'node:url';

const REQUIRED_PLANNER = {
  mode: 'current',
  bundleReader: 3,
};

export function evaluateDeployment(
  { ready, release, cron, legal },
  expectedSha,
  expectedEnvironment,
) {
  const releaseMatches =
    release?.status === 'ok' &&
    release.release?.sha === expectedSha &&
    release.release?.environment === expectedEnvironment &&
    Object.entries(REQUIRED_PLANNER).every(([key, value]) => release.planner?.[key] === value) &&
    ['off', 'active'].includes(release.planner?.canopyModelMode);
  const readyMatches =
    ready?.status === 'ready' &&
    ready.release?.sha === expectedSha &&
    ready.release?.environment === expectedEnvironment &&
    Object.entries(REQUIRED_PLANNER).every(([key, value]) => ready.planner?.[key] === value) &&
    ['off', 'active'].includes(ready.planner?.canopyModelMode);
  const cronMatches =
    cron?.status === 'ok' &&
    cron.schedulerRelease?.sha === expectedSha &&
    cron.schedulerRelease?.environment === expectedEnvironment;
  const legalMatches = legal?.service === 'runcast-legal' && legal.sha === expectedSha;

  return {
    ok: releaseMatches && readyMatches && cronMatches && legalMatches,
    releaseMatches,
    readyMatches,
    cronMatches,
    legalMatches,
  };
}

async function readJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return body;
}

export async function verifyRelease({
  baseUrl,
  legalUrl,
  expectedSha,
  expectedEnvironment,
  attempts = 91,
  intervalMs = 20_000,
}) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  const normalizedLegalUrl = legalUrl.replace(/\/+$/, '');
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [ready, release, cron, legal] = await Promise.all([
        readJson(normalizedUrl, '/health/ready'),
        readJson(normalizedUrl, '/health/release'),
        readJson(normalizedUrl, '/health/cron'),
        readJson(
          normalizedLegalUrl,
          `/release.json?expected=${encodeURIComponent(expectedSha)}&attempt=${attempt}`,
        ),
      ]);
      lastResult = evaluateDeployment(
        { ready, release, cron, legal },
        expectedSha,
        expectedEnvironment,
      );
      lastError = null;
      console.log(
        JSON.stringify({
          event: 'release.verify',
          attempt,
          ...lastResult,
          observedApiSha: release?.release?.sha ?? null,
          observedCronSha: cron?.schedulerRelease?.sha ?? null,
          observedLegalSha: legal?.sha ?? null,
        }),
      );
      if (lastResult.ok) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unknown verification error';
      console.log(JSON.stringify({ event: 'release.verify.waiting', attempt, error: lastError }));
    }

    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Release verification failed after ${attempts} attempts: ${lastError ?? JSON.stringify(lastResult)}`,
  );
}

async function main() {
  const [baseUrl, legalUrl, expectedSha, expectedEnvironment] = process.argv.slice(2);
  if (!baseUrl || !legalUrl || !expectedSha || !expectedEnvironment) {
    throw new Error(
      'Usage: node scripts/verify-release.mjs <api-base-url> <legal-base-url> <expected-sha> <expected-environment>',
    );
  }
  await verifyRelease({ baseUrl, legalUrl, expectedSha, expectedEnvironment });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
