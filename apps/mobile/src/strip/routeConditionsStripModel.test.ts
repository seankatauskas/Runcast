import { describe, expect, it } from 'vitest';
import {
  AMBIENT_HEADWIND_DOMAIN_MS,
  buildSunExposureDisplayBands,
  forecastSunlightOpacity,
  SUN_EXPOSURE_DISPLAY_MODEL_VERSION,
  sunExposureDisplayForWoodlandEvidence,
  windPlotSample,
} from '@runcast/core';

describe('condition strip visual model', () => {
  it('uses a fixed comparable headwind scale and clips extremes', () => {
    expect(windPlotSample({ ambientHeadwindMs: 6, ambientCrosswindMs: 0 })).toMatchObject({
      headFraction: 0.5,
      tailFraction: 0,
    });
    expect(
      windPlotSample({
        ambientHeadwindMs: AMBIENT_HEADWIND_DOMAIN_MS * 2,
        ambientCrosswindMs: 0,
      }).headFraction,
    ).toBe(1);
  });

  it('puts tailwind below calm and retains crosswind side', () => {
    expect(windPlotSample({ ambientHeadwindMs: -3, ambientCrosswindMs: 5 })).toEqual({
      headFraction: 0,
      tailFraction: 0.25,
      crossFraction: 0.5,
      crossDirection: 1,
    });
    expect(windPlotSample({ ambientHeadwindMs: 0, ambientCrosswindMs: -2 }).crossDirection).toBe(
      -1,
    );
  });

  it('uses the standard background only for mapped woodland', () => {
    expect(sunExposureDisplayForWoodlandEvidence('mapped-woodland')).toEqual({
      version: SUN_EXPOSURE_DISPLAY_MODEL_VERSION,
      daylight: true,
      forecastSunlight: false,
      intensityLevel: 'minimal',
      woodlandEvidence: 'mapped-woodland',
      possibleShade: true,
      accessibilityReason: 'possible shade based on mapped woodland',
    });
  });

  it('shows canopy-adjusted radiation as softer yellow instead of binary woodland shade', () => {
    const openSky = sunExposureDisplayForWoodlandEvidence('mapped-woodland', true, 800, 'active');
    const canopyFiltered = sunExposureDisplayForWoodlandEvidence(
      'mapped-woodland',
      true,
      590,
      'active',
    );

    expect(openSky).toMatchObject({ forecastSunlight: true, intensityLevel: 'high' });
    expect(canopyFiltered).toMatchObject({
      forecastSunlight: true,
      intensityLevel: 'moderate',
      possibleShade: false,
    });
    expect(forecastSunlightOpacity(canopyFiltered.intensityLevel)).toBeLessThan(
      forecastSunlightOpacity(openSky.intensityLevel),
    );
  });

  it('never shows forecast sunlight or possible shade after sunset', () => {
    expect(sunExposureDisplayForWoodlandEvidence('no-mapped-woodland', false)).toEqual({
      version: SUN_EXPOSURE_DISPLAY_MODEL_VERSION,
      daylight: false,
      forecastSunlight: false,
      intensityLevel: 'none',
      woodlandEvidence: 'no-mapped-woodland',
      possibleShade: false,
      accessibilityReason: 'no forecast sun after sunset',
    });
  });

  it('shows open and unknown evidence as sun rather than promising shade', () => {
    expect(sunExposureDisplayForWoodlandEvidence('no-mapped-woodland')).toMatchObject({
      forecastSunlight: true,
      possibleShade: false,
    });
    expect(sunExposureDisplayForWoodlandEvidence('unknown')).toMatchObject({
      forecastSunlight: true,
      woodlandEvidence: 'unknown',
      possibleShade: false,
      accessibilityReason: 'sun shown conservatively because shade evidence is unavailable',
    });
  });

  it('coalesces neighboring sections so sample boundaries do not look like shade', () => {
    expect(
      buildSunExposureDisplayBands([
        {
          distanceM: 0,
          daylight: true,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 10,
        },
        {
          distanceM: 100,
          daylight: true,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 10,
        },
        { distanceM: 200, daylight: true, woodlandEvidence: 'unknown', radiationWm2: 10 },
        { distanceM: 300, daylight: true, woodlandEvidence: 'unknown', radiationWm2: 10 },
      ]),
    ).toEqual([
      {
        startDistanceM: 0,
        endDistanceM: 300,
        segmentDisplay: {
          version: SUN_EXPOSURE_DISPLAY_MODEL_VERSION,
          daylight: true,
          forecastSunlight: true,
          intensityLevel: 'minimal',
          woodlandEvidence: 'no-mapped-woodland',
          possibleShade: false,
          accessibilityReason: 'sun shown because there is no mapped woodland',
        },
      },
    ]);
  });

  it('switches the strip from sun to night when the run crosses sunset', () => {
    expect(
      buildSunExposureDisplayBands([
        {
          distanceM: 0,
          daylight: true,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 10,
        },
        {
          distanceM: 100,
          daylight: false,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 0,
        },
        {
          distanceM: 200,
          daylight: false,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 0,
        },
      ]).map(({ startDistanceM, endDistanceM, segmentDisplay }) => ({
        startDistanceM,
        endDistanceM,
        daylight: segmentDisplay.daylight,
        forecastSunlight: segmentDisplay.forecastSunlight,
      })),
    ).toEqual([
      { startDistanceM: 0, endDistanceM: 50, daylight: true, forecastSunlight: true },
      { startDistanceM: 50, endDistanceM: 200, daylight: false, forecastSunlight: false },
    ]);
  });

  it('switches the strip from night to visible minimal sun across sunrise', () => {
    expect(
      buildSunExposureDisplayBands([
        {
          distanceM: 0,
          daylight: false,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 0,
        },
        {
          distanceM: 100,
          daylight: true,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 0,
        },
        {
          distanceM: 200,
          daylight: true,
          woodlandEvidence: 'no-mapped-woodland',
          radiationWm2: 4,
        },
      ]).map(({ startDistanceM, endDistanceM, segmentDisplay }) => ({
        startDistanceM,
        endDistanceM,
        daylight: segmentDisplay.daylight,
        forecastSunlight: segmentDisplay.forecastSunlight,
        intensityLevel: segmentDisplay.intensityLevel,
      })),
    ).toEqual([
      {
        startDistanceM: 0,
        endDistanceM: 50,
        daylight: false,
        forecastSunlight: false,
        intensityLevel: 'none',
      },
      {
        startDistanceM: 50,
        endDistanceM: 200,
        daylight: true,
        forecastSunlight: true,
        intensityLevel: 'minimal',
      },
    ]);
  });

  it('mirrors combined bands when a route is reversed', () => {
    const forward = [
      {
        distanceM: 0,
        daylight: true,
        radiationWm2: 10,
        woodlandEvidence: 'mapped-woodland' as const,
      },
      {
        distanceM: 100,
        daylight: true,
        radiationWm2: 10,
        woodlandEvidence: 'mapped-woodland' as const,
      },
      {
        distanceM: 300,
        daylight: true,
        radiationWm2: 10,
        woodlandEvidence: 'no-mapped-woodland' as const,
      },
    ];
    const reversed = [...forward]
      .reverse()
      .map((sample) => ({ ...sample, distanceM: 300 - sample.distanceM }));

    const forwardVisuals = buildSunExposureDisplayBands(forward).map(
      ({ segmentDisplay }) => segmentDisplay.forecastSunlight,
    );
    const reversedVisuals = buildSunExposureDisplayBands(reversed)
      .reverse()
      .map(({ segmentDisplay }) => segmentDisplay.forecastSunlight);
    expect(reversedVisuals).toEqual(forwardVisuals);
  });
});
