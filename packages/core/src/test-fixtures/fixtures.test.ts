import { describe, expect, it } from 'vitest';
import {
  actionabilityFixture,
  dstOccurrenceFixtures,
  eastboundRouteFixture,
  finishValidityFixture,
  hazardPolicyFixtures,
  recommendationScenarioFixtures,
  reverseRouteFixture,
  timeWeightingFixtures,
  westboundRouteFixture,
  windVectorFixtures,
} from './evaluation-fixtures';
import {
  GPX_MAX_POINTS,
  GPX_MAX_UTF8_BYTES,
  buildPointCountGpx,
  buildStravaExportResponseFixture,
  buildUtf8SizedGpx,
  gpxSourceFixtures,
} from './gpx-fixtures';
import { legacyReplayFixture } from './legacy-replay-fixtures';
import { osmEvidenceFixtures } from './osm-fixtures';
import {
  expectedTemporalSemantics,
  forecastFreshnessFixtures,
  forecastValidityFixtures,
  makeValidWeatherPayload,
  weatherNormalizationFixtures,
} from './weather-fixtures';

describe('GPX test-fixture generators', () => {
  it('builds exact point-limit boundary sources', () => {
    const atLimit = buildPointCountGpx(GPX_MAX_POINTS);
    const overLimit = buildPointCountGpx(GPX_MAX_POINTS + 1);
    expect(atLimit.match(/<trkpt /g)).toHaveLength(GPX_MAX_POINTS);
    expect(overLimit.match(/<trkpt /g)).toHaveLength(GPX_MAX_POINTS + 1);
  });

  it('builds exact UTF-8 byte-limit boundary sources', () => {
    const encoder = new TextEncoder();
    expect(encoder.encode(buildUtf8SizedGpx(GPX_MAX_UTF8_BYTES)).byteLength).toBe(
      GPX_MAX_UTF8_BYTES,
    );
    expect(encoder.encode(buildUtf8SizedGpx(GPX_MAX_UTF8_BYTES + 1)).byteLength).toBe(
      GPX_MAX_UTF8_BYTES + 1,
    );
  });

  it('models chunked Strava responses with and without content-length', () => {
    const accepted = buildStravaExportResponseFixture({
      byteCount: GPX_MAX_UTF8_BYTES,
      includeContentLength: false,
    });
    const rejected = buildStravaExportResponseFixture({ pointCount: GPX_MAX_POINTS + 1 });
    expect(accepted.headers.contentLength).toBeNull();
    expect(accepted.chunks.length).toBeGreaterThan(1);
    expect(accepted.expected.outcome).toBe('accepted');
    expect(rejected.expected).toEqual({
      outcome: 'rejected',
      reason: 'POINT_LIMIT_EXCEEDED',
    });
  });

  it('keeps missing elevation, sea level, topology, and XML attacks distinct', () => {
    expect(gpxSourceFixtures.missingElevation.expected).toMatchObject({
      outcome: 'accepted',
      elevationStatus: 'absent',
    });
    expect(gpxSourceFixtures.seaLevelElevation.expected).toMatchObject({
      outcome: 'accepted',
      elevationStatus: 'complete',
    });
    expect(gpxSourceFixtures.multipleSegments.expected.outcome).toBe('rejected');
    expect(gpxSourceFixtures.externalEntity.xml).toContain('SYSTEM "file:///etc/passwd"');
  });
});

describe('weather test fixtures', () => {
  it('returns fresh independent valid payloads with aligned arrays', () => {
    const first = makeValidWeatherPayload();
    const second = makeValidWeatherPayload();
    first.hourly.temperature_2m[0] = -99;
    expect(second.hourly.temperature_2m[0]).toBe(20);

    const expectedLength = second.hourly.time.length;
    for (const [variable, values] of Object.entries(second.hourly)) {
      expect(values, variable).toHaveLength(expectedLength);
    }
  });

  it('preserves provider null and covers every required rejection family', () => {
    expect(
      weatherNormalizationFixtures.validWithProviderNull.payload.hourly
        .precipitation_probability[0],
    ).toBeNull();
    const reasons = Object.values(weatherNormalizationFixtures)
      .map((value) => value.expected)
      .filter((value) => value.outcome === 'rejected')
      .map((value) => value.reason);
    expect(new Set(reasons)).toEqual(
      new Set([
        'ARRAY_LENGTH_MISMATCH',
        'DUPLICATE_TIME',
        'INVALID_RANGE',
        'INVALID_UNIT',
        'UNSORTED_TIME',
      ]),
    );
  });

  it('declares radiation and precipitation interval semantics explicitly', () => {
    expect(expectedTemporalSemantics.precipitation).toBe('preceding-interval-sum');
    expect(expectedTemporalSemantics.precipitation_probability).toBe(
      'preceding-interval-probability',
    );
    expect(expectedTemporalSemantics.shortwave_radiation).toBe('preceding-interval-mean');
    expect(expectedTemporalSemantics.direct_normal_irradiance).toBe('preceding-interval-mean');
    expect(forecastValidityFixtures.finishAfterValidity.expected).toBe('unevaluable');
    expect(forecastFreshnessFixtures.staleWithinValidity.expected).toBe('stale-within-validity');
    expect(forecastFreshnessFixtures.expired.expected).toBe('expired');
  });
});

describe('OSM evidence fixtures', () => {
  it('covers disjoint outers, holes, split members, malformed, partial, and empty evidence', () => {
    expect(osmEvidenceFixtures.disjointOuterRelation.expected.polygonCount).toBe(2);
    expect(osmEvidenceFixtures.relationWithInnerHole.expected.holeCount).toBe(1);
    expect(osmEvidenceFixtures.reversedSplitMembers.expected.completeness).toBe('complete');
    expect(osmEvidenceFixtures.malformedUnclosedRelation.expected.evidence).toBe('unknown');
    expect(osmEvidenceFixtures.timeoutLikePartialResponse.expected.evidence).toBe('unknown');
    expect(osmEvidenceFixtures.completeEmptyResponse.expected.evidence).toBe('no-mapped-woodland');
  });
});

describe('evaluation and recommendation fixtures', () => {
  it('covers all four recommendation statuses', () => {
    expect(
      new Set(Object.values(recommendationScenarioFixtures).map((value) => value.expected.status)),
    ).toEqual(new Set(['recommended', 'caution', 'no-suitable-window', 'unavailable']));
  });

  it('places the first actionable candidate on the window-origin grid', () => {
    const lowerBound = actionabilityFixture.decisionTime + actionabilityFixture.minimumNoticeMs;
    expect(lowerBound).toBe(actionabilityFixture.expectedGridStarts[0]);
    for (const start of actionabilityFixture.expectedGridStarts) {
      expect((start - actionabilityFixture.windowStart) % (15 * 60_000)).toBe(0);
    }
  });

  it('distinguishes start-window eligibility from forecast-finish validity', () => {
    expect(finishValidityFixture.startWindowPolicy).toBe('start-within');
    expect(finishValidityFixture.expected.at(-1)).toEqual({
      startTime: finishValidityFixture.windowEnd,
      finishWithinValidity: false,
    });
  });

  it('freezes threshold, DST, route reversal, and wind baselines', () => {
    expect(hazardPolicyFixtures.extremeHeatBoundary.inputs.feelsLikeC).toBe(35);
    expect(hazardPolicyFixtures.highWindBoundary.inputs.gustMps).toBe(17);
    expect(dstOccurrenceFixtures.springForwardGap.expectedInstants).toHaveLength(0);
    expect(dstOccurrenceFixtures.fallBackFold.expectedInstants).toHaveLength(2);
    expect(reverseRouteFixture(eastboundRouteFixture)).toEqual(westboundRouteFixture);
    expect(windVectorFixtures.stillAir.expected.oppositionDelta).toBe(0);
    expect(windVectorFixtures.followingMatchesPace.expected.apparentAirSpeedMps).toBe(0);
  });

  it('makes trapezoidal exposure invariant to linear resampling', () => {
    const mean = (samples: readonly { elapsedMs: number; value: number }[]): number => {
      let integral = 0;
      for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        integral +=
          ((previous.value + current.value) / 2) * (current.elapsedMs - previous.elapsedMs);
      }
      return integral / samples.at(-1)!.elapsedMs;
    };
    expect(mean(timeWeightingFixtures.coarse)).toBeCloseTo(
      timeWeightingFixtures.expectedTrapezoidalMean,
      12,
    );
    expect(mean(timeWeightingFixtures.linearlyResampled)).toBeCloseTo(
      timeWeightingFixtures.expectedTrapezoidalMean,
      12,
    );
  });
});

describe('legacy replay fixture', () => {
  it('round-trips as JSON without reinterpreting ambiguous zero elevation', () => {
    const replay = JSON.parse(JSON.stringify(legacyReplayFixture)) as typeof legacyReplayFixture;
    expect(replay.route.points[1].ele).toBe(0);
    expect(replay.expectedV2Adaptation).toEqual({
      elevationStatus: 'legacy-unknown',
      timingModel: 'flat-v1',
      reasons: ['LEGACY_ELEVATION_AMBIGUOUS', 'FLAT_TIMING_FALLBACK'],
    });
  });
});
