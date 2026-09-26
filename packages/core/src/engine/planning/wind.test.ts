import { describe, expect, it } from 'vitest';
import { windVectorFixtures } from '../../test-fixtures/evaluation-fixtures';
import { runnerRelativeWind } from './wind';

describe('runnerRelativeWind', () => {
  for (const [name, fixture] of Object.entries(windVectorFixtures)) {
    it(name, () => {
      const wind = runnerRelativeWind({
        ambientSpeedMs: fixture.ambientSpeedMps,
        meteorologicalFromDeg: fixture.meteorologicalFromDeg,
        runnerBearingDeg: fixture.routeBearingDeg,
        runnerSpeedMs: fixture.runnerSpeedMps,
      });
      expect(wind.ambient.alongTrackMs).toBeCloseTo(fixture.expected.ambientAlongMps, 10);
      expect(wind.ambient.crossTrackMs).toBeCloseTo(fixture.expected.ambientCrossMps, 10);
      expect(wind.apparentAirflow.speedMs).toBeCloseTo(fixture.expected.apparentAirSpeedMps, 10);
      expect(wind.aerodynamicOppositionDelta).toBeCloseTo(fixture.expected.oppositionDelta, 10);
      expect(Math.hypot(wind.ambient.vector.eastMs, wind.ambient.vector.northMs)).toBeCloseTo(
        fixture.ambientSpeedMps,
        10,
      );
    });
  }

  it('is rotation invariant and reversal swaps the ambient along-track sign', () => {
    const baseline = runnerRelativeWind({
      ambientSpeedMs: 5,
      meteorologicalFromDeg: 20,
      runnerBearingDeg: 80,
      runnerSpeedMs: 4,
    });
    const rotated = runnerRelativeWind({
      ambientSpeedMs: 5,
      meteorologicalFromDeg: 143,
      runnerBearingDeg: 203,
      runnerSpeedMs: 4,
    });
    const reversed = runnerRelativeWind({
      ambientSpeedMs: 5,
      meteorologicalFromDeg: 20,
      runnerBearingDeg: 260,
      runnerSpeedMs: 4,
    });
    expect(rotated.ambient.alongTrackMs).toBeCloseTo(baseline.ambient.alongTrackMs, 10);
    expect(rotated.ambient.crossTrackMs).toBeCloseTo(baseline.ambient.crossTrackMs, 10);
    expect(reversed.ambient.alongTrackMs).toBeCloseTo(-baseline.ambient.alongTrackMs, 10);
  });

  it('reports assistance when following wind exceeds pace', () => {
    const wind = runnerRelativeWind({
      ambientSpeedMs: 6,
      meteorologicalFromDeg: 270,
      runnerBearingDeg: 90,
      runnerSpeedMs: 4,
    });
    expect(wind.apparentAirflow.alongTrackMs).toBeGreaterThan(0);
    expect(wind.aerodynamicOppositionDelta).toBeLessThan(-16);
  });
});
