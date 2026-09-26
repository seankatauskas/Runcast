import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const reviewedHighAdvisories = new Map([
  [
    1138808,
    {
      expires: '2026-09-15',
      reason:
        'Expo SDK 57 build tooling reaches image-size through Metro; Runcast processes only repository-controlled app assets during builds.',
    },
  ],
  [
    1138809,
    {
      expires: '2026-09-15',
      reason:
        'Expo SDK 57 build tooling reaches image-size through Metro; Runcast processes only repository-controlled app assets during builds.',
    },
  ],
]);

export function directAdvisories(report) {
  const bySource = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === 'object' && via && typeof via.source === 'number') {
        bySource.set(via.source, via);
      }
    }
  }
  return [...bySource.values()];
}

export function evaluateAuditReport(report, now = new Date()) {
  const blocking = [];
  const reviewed = [];
  for (const advisory of directAdvisories(report)) {
    if (!['high', 'critical'].includes(advisory.severity)) continue;
    const acceptance = reviewedHighAdvisories.get(advisory.source);
    if (!acceptance || now > new Date(`${acceptance.expires}T23:59:59.999Z`)) {
      blocking.push(advisory);
    } else {
      reviewed.push({ advisory, ...acceptance });
    }
  }
  if ((report?.metadata?.vulnerabilities?.critical ?? 0) > 0) {
    const criticalSources = blocking.filter((item) => item.severity === 'critical');
    if (criticalSources.length === 0) {
      blocking.push({
        source: 'aggregate-critical',
        severity: 'critical',
        title: 'npm reported a critical dependency path without a direct advisory object',
      });
    }
  }
  return { blocking, reviewed };
}

export function parseAuditExecution(result) {
  if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
    throw new Error('npm audit did not complete normally');
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error('npm audit did not return valid JSON');
  }
  if (
    report?.error ||
    !report?.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    !report?.metadata?.vulnerabilities ||
    typeof report.metadata.vulnerabilities.high !== 'number' ||
    typeof report.metadata.vulnerabilities.critical !== 'number'
  ) {
    throw new Error('npm audit returned an error or an incomplete vulnerability report');
  }
  return report;
}

function main() {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
  });
  const report = parseAuditExecution(result);
  const policy = evaluateAuditReport(report);
  console.log(
    JSON.stringify(
      {
        event: 'dependency.audit',
        totals: report.metadata?.vulnerabilities ?? null,
        reviewed: policy.reviewed.map(({ advisory, expires, reason }) => ({
          source: advisory.source,
          title: advisory.title,
          severity: advisory.severity,
          expires,
          reason,
        })),
        blocking: policy.blocking.map(({ source, title, severity, url }) => ({
          source,
          title,
          severity,
          url,
        })),
      },
      null,
      2,
    ),
  );
  if (policy.blocking.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
