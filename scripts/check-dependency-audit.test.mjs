import { describe, expect, it } from 'vitest';
import {
  directAdvisories,
  evaluateAuditReport,
  parseAuditExecution,
} from './check-dependency-audit.mjs';

function report(advisories, critical = 0) {
  return {
    vulnerabilities: Object.fromEntries(
      advisories.map((advisory, index) => [`dependency-${index}`, { via: [advisory] }]),
    ),
    metadata: {
      vulnerabilities: {
        high: advisories.filter((item) => item.severity === 'high').length,
        critical,
      },
    },
  };
}

describe('dependency audit policy', () => {
  it('fails closed when npm fails or returns an incomplete report', () => {
    expect(() =>
      parseAuditExecution({ status: 1, signal: null, stdout: JSON.stringify({ error: {} }) }),
    ).toThrow(/incomplete vulnerability report/);
    expect(() =>
      parseAuditExecution({ status: 2, signal: null, stdout: JSON.stringify(report([])) }),
    ).toThrow(/did not complete normally/);
    expect(() => parseAuditExecution({ status: 0, signal: null, stdout: '{}' })).toThrow(
      /incomplete vulnerability report/,
    );
  });

  it('accepts npm vulnerability exit code after validating the report schema', () => {
    const auditReport = report([{ source: 999, severity: 'high' }]);
    expect(
      parseAuditExecution({
        status: 1,
        signal: null,
        stdout: JSON.stringify(auditReport),
      }),
    ).toEqual(auditReport);
  });

  it('deduplicates direct advisories hidden behind aggregate dependency paths', () => {
    const advisory = { source: 1138808, severity: 'high', title: 'reviewed' };
    const input = {
      vulnerabilities: {
        leaf: { via: [advisory] },
        aggregate: { via: ['leaf', advisory] },
      },
    };
    expect(directAdvisories(input)).toEqual([advisory]);
  });

  it('accepts the time-bounded reviewed Metro image parser advisories', () => {
    const policy = evaluateAuditReport(
      report([
        { source: 1138808, severity: 'high', title: 'ICNS parser' },
        { source: 1138809, severity: 'high', title: 'JXL parser' },
      ]),
      new Date('2026-08-15T00:00:00.000Z'),
    );
    expect(policy.blocking).toEqual([]);
    expect(policy.reviewed).toHaveLength(2);
  });

  it('blocks a new high advisory or an expired acceptance', () => {
    expect(
      evaluateAuditReport(
        report([{ source: 9999999, severity: 'high', title: 'new issue' }]),
        new Date('2026-08-15T00:00:00.000Z'),
      ).blocking,
    ).toHaveLength(1);
    expect(
      evaluateAuditReport(
        report([{ source: 1138808, severity: 'high', title: 'reviewed' }]),
        new Date('2026-09-16T00:00:00.000Z'),
      ).blocking,
    ).toHaveLength(1);
  });

  it('blocks aggregate critical findings even if npm omits a leaf object', () => {
    expect(evaluateAuditReport(report([], 1)).blocking).toEqual([
      expect.objectContaining({ source: 'aggregate-critical', severity: 'critical' }),
    ]);
  });
});
