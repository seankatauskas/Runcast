import { describe, expect, it } from 'vitest';
import { runBrowserGolden } from './browser-entry';
import { runHermesCompatibleGolden } from './hermes-entry';
import { runNodeGolden } from './node-entry';
import { CROSS_RUNTIME_WINDOW_START } from './scenario';

const FIFTEEN_MINUTES_MS = 15 * 60_000;

describe('V2 cross-runtime golden', () => {
  it('matches candidate identity and decision fields across import surfaces', () => {
    const node = runNodeGolden();
    const browser = runBrowserGolden();
    const hermesCompatible = runHermesCompatibleGolden();

    expect(node).toMatchObject({
      status: 'recommended',
      winnerStart: CROSS_RUNTIME_WINDOW_START,
      candidateStarts: [
        CROSS_RUNTIME_WINDOW_START,
        CROSS_RUNTIME_WINDOW_START + FIFTEEN_MINUTES_MS,
        CROSS_RUNTIME_WINDOW_START + 2 * FIFTEEN_MINUTES_MS,
        CROSS_RUNTIME_WINDOW_START + 3 * FIFTEEN_MINUTES_MS,
        CROSS_RUNTIME_WINDOW_START + 4 * FIFTEEN_MINUTES_MS,
      ],
      candidateReasons: Array.from({ length: 5 }, () => ['canopy.unavailable']),
      evaluationId: '20f9e1021249e4ac3a53d3a9c0e26cf8cb7742a59dbe0061f30d5cf4b0acb177',
    });
    for (const result of [browser, hermesCompatible]) {
      expect(result.status).toBe(node.status);
      expect(result.winnerStart).toBe(node.winnerStart);
      expect(result.candidateStarts).toEqual(node.candidateStarts);
      expect(result.candidateReasons).toEqual(node.candidateReasons);
      expect(result.evaluationId).toBe(node.evaluationId);
      // Float tolerance documents the portable numeric contract. Identity
      // equality above is stricter for the currently tested JS engines.
      expect(result.conditionsFit).toBeCloseTo(node.conditionsFit!, 10);
      expect(result.durationSeconds).toBeCloseTo(node.durationSeconds!, 6);
      expect(result.radiationDoseJm2).toBeCloseTo(node.radiationDoseJm2!, 3);
    }
  });

  it('abstains identically when a required provider value is unresolved', () => {
    for (const run of [runNodeGolden, runBrowserGolden, runHermesCompatibleGolden]) {
      const result = run('missing-required-input');
      expect(result).toMatchObject({
        status: 'unavailable',
        winnerStart: null,
      });
      expect(result.candidateReasons.flat()).toContain(
        'weather.missing-critical-field:temperatureC',
      );
    }
  });

  it('hard-blocks thunder without allowing fit to compensate', () => {
    for (const run of [runNodeGolden, runBrowserGolden, runHermesCompatibleGolden]) {
      const result = run('thunderstorm');
      expect(result).toMatchObject({
        status: 'no-suitable-window',
        winnerStart: null,
      });
      expect(result.candidateReasons.flat()).toContain('safety.thunderstorm');
    }
  });
});
