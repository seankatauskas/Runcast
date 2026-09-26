import { describe, expect, it } from 'vitest';
import {
  INTRODUCTION_GUIDED_STEPS,
  introductionProgressDotStates,
  introductionStepBelongsToSurface,
  introductionStepPresentation,
  nextIntroductionStep,
  placeIntroductionCoachmark,
  placeIntroductionDockedCoachmark,
  previousIntroductionStep,
  type IntroductionFacts,
} from './IntroductionPresentation';

const facts: IntroductionFacts = {
  routeName: 'Chicago Lakefront Trail',
};

describe('introduction presentation', () => {
  it('teaches the six-step route, timing, conditions, outlook, and watch story', () => {
    const presentations = INTRODUCTION_GUIDED_STEPS.map((step) =>
      introductionStepPresentation(step, facts),
    );

    expect(presentations.map((item) => item.progress)).toEqual([
      '1 of 6',
      '2 of 6',
      '3 of 6',
      '4 of 6',
      '5 of 6',
      '6 of 6',
    ]);
    expect(presentations.map((item) => item.title)).toEqual([
      'Route',
      'Start time',
      'Pace',
      'Best-start conditions',
      'Day outlook',
      'Route watch',
    ]);
    expect(presentations.map((item) => item.target)).toEqual([
      'route-picker',
      'start-time',
      'pace',
      'along-route',
      'day-outlook',
      'watch-route',
    ]);
    expect(presentations[0].message).toContain(facts.routeName);
    expect(presentations[0].coachmarkGap).toBe(18);
    expect(presentations[2].coachmarkGap).toBe(12);
    expect(presentations[3].message).toContain('time shown above');
    expect(presentations[3]).toMatchObject({
      placementTarget: 'run-card',
      coachmarkAlignment: 'left',
      coachmarkGap: 12,
    });
    expect(presentations[3].relatedTargets).toEqual([]);
    expect(presentations[4]).toMatchObject({
      coachmarkMode: 'bottom-docked',
      message: expect.stringContaining('recommended start that day'),
    });
    expect(presentations[5]).toMatchObject({
      target: 'watch-route',
      coachmarkMode: 'bottom-docked',
      message: 'Choose a schedule and get an alert when conditions line up.',
    });
  });

  it('uses neutral navigation labels instead of describing another step', () => {
    expect(
      INTRODUCTION_GUIDED_STEPS.map(
        (step) => introductionStepPresentation(step, facts).actionLabel,
      ),
    ).toEqual(['Next', 'Next', 'Next', 'View run plan', 'Next', 'Done']);
  });

  it('fills progress dots cumulatively through all six guided steps', () => {
    expect(INTRODUCTION_GUIDED_STEPS.map(introductionProgressDotStates)).toEqual([
      [true, false, false, false, false, false],
      [true, true, false, false, false, false],
      [true, true, true, false, false, false],
      [true, true, true, true, false, false],
      [true, true, true, true, true, false],
      [true, true, true, true, true, true],
    ]);
  });

  it('only presents a guided step on the screen that owns its target', () => {
    expect(introductionStepBelongsToSurface('conditions', 'explorer')).toBe(true);
    expect(introductionStepBelongsToSurface('conditions', 'planner')).toBe(false);
    expect(introductionStepBelongsToSurface('day-outlook', 'planner')).toBe(true);
    expect(introductionStepBelongsToSurface('day-outlook', 'explorer')).toBe(false);
    expect(introductionStepBelongsToSurface('watch', 'planner')).toBe(true);
    expect(introductionStepBelongsToSurface('watch', 'explorer')).toBe(false);
  });

  it('moves forward and backward through the invitation and guided steps', () => {
    expect(nextIntroductionStep('invite')).toBe('route');
    expect(nextIntroductionStep('conditions')).toBe('day-outlook');
    expect(nextIntroductionStep('day-outlook')).toBe('watch');
    expect(nextIntroductionStep('watch')).toBeNull();
    expect(previousIntroductionStep('route')).toBe('invite');
    expect(previousIntroductionStep('day-outlook')).toBe('conditions');
    expect(previousIntroductionStep('watch')).toBe('day-outlook');
    expect(previousIntroductionStep('invite')).toBeNull();
  });

  it('places a coachmark below a top target and clamps it to screen margins', () => {
    expect(
      placeIntroductionCoachmark({
        target: { x: 4, y: 54, width: 180, height: 44 },
        coachmarkWidth: 280,
        coachmarkHeight: 150,
        windowWidth: 390,
        windowHeight: 844,
        insetTop: 47,
        insetBottom: 34,
      }),
    ).toMatchObject({ left: 16, top: 122, side: 'below' });
  });

  it('places a coachmark above controls near the bottom of the screen', () => {
    const placement = placeIntroductionCoachmark({
      target: { x: 240, y: 620, width: 130, height: 56 },
      coachmarkWidth: 280,
      coachmarkHeight: 160,
      windowWidth: 390,
      windowHeight: 844,
      insetTop: 47,
      insetBottom: 34,
    });

    expect(placement.side).toBe('above');
    expect(placement.top).toBe(436);
    expect(placement.left).toBe(94);
    expect(placement.pointerLeft).toBeLessThanOrEqual(250);
  });

  it('can align to a card while keeping the pointer aimed at its highlighted control', () => {
    expect(
      placeIntroductionCoachmark({
        target: { x: 130, y: 390, width: 80, height: 44 },
        placementTarget: { x: 16, y: 360, width: 358, height: 400 },
        coachmarkWidth: 280,
        coachmarkHeight: 160,
        windowWidth: 390,
        windowHeight: 844,
        insetTop: 47,
        insetBottom: 34,
        gap: 12,
        horizontalAlignment: 'left',
      }),
    ).toEqual({ left: 16, top: 188, side: 'above', pointerLeft: 148 });
  });

  it('docks the final coachmark above the bottom safe area', () => {
    expect(
      placeIntroductionDockedCoachmark({
        coachmarkWidth: 358,
        coachmarkHeight: 140,
        windowWidth: 390,
        windowHeight: 844,
        insetTop: 0,
        insetBottom: 34,
      }),
    ).toEqual({ left: 16, top: 654 });
  });
});
