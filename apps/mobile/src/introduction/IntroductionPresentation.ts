export type IntroductionMode = 'first-run' | 'replay';
export type IntroductionSurface = 'explorer' | 'planner';

export type IntroductionStep =
  'invite' | 'route' | 'start-time' | 'pace' | 'conditions' | 'day-outlook' | 'watch';

export type IntroductionTargetId =
  | 'route-picker'
  | 'run-card'
  | 'start-time'
  | 'pace'
  | 'along-route'
  | 'full-plan'
  | 'day-outlook'
  | 'watch-route';

export interface IntroductionFlow {
  mode: IntroductionMode;
  step: IntroductionStep;
}

export interface IntroductionFacts {
  routeName: string;
}

export interface IntroductionStepPresentation {
  progress: string;
  title: string;
  target: IntroductionTargetId;
  placementTarget?: IntroductionTargetId;
  coachmarkAlignment?: 'center' | 'left';
  coachmarkGap?: number;
  coachmarkMode?: 'target' | 'bottom-docked';
  relatedTargets: readonly IntroductionTargetId[];
  message: string;
  actionLabel: string;
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoachmarkPlacement {
  left: number;
  top: number;
  side: 'above' | 'below';
  pointerLeft: number;
}

export interface DockedCoachmarkPlacement {
  left: number;
  top: number;
}

export const INTRODUCTION_GUIDED_STEPS = [
  'route',
  'start-time',
  'pace',
  'conditions',
  'day-outlook',
  'watch',
] as const satisfies readonly IntroductionStep[];

export function introductionStepPresentation(
  step: Exclude<IntroductionStep, 'invite'>,
  facts: IntroductionFacts,
): IntroductionStepPresentation {
  const stepNumber = INTRODUCTION_GUIDED_STEPS.indexOf(step) + 1;
  const progress = `${stepNumber} of ${INTRODUCTION_GUIDED_STEPS.length}`;
  const actionLabel = step === 'conditions' ? 'View run plan' : step === 'watch' ? 'Done' : 'Next';
  if (step === 'route') {
    return {
      progress,
      title: 'Route',
      target: 'route-picker',
      coachmarkGap: 18,
      relatedTargets: [],
      message: `${facts.routeName} is ready to explore without an account.`,
      actionLabel,
    };
  }
  if (step === 'start-time') {
    return {
      progress,
      title: 'Start time',
      target: 'start-time',
      relatedTargets: [],
      message: 'Start with the recommended time, or compare another departure that fits your day.',
      actionLabel,
    };
  }
  if (step === 'pace') {
    return {
      progress,
      title: 'Pace',
      target: 'pace',
      placementTarget: 'run-card',
      coachmarkAlignment: 'left',
      coachmarkGap: 12,
      relatedTargets: [],
      message: 'Your pace changes those arrival times—and the conditions you’ll meet.',
      actionLabel,
    };
  }
  if (step === 'conditions') {
    return {
      progress,
      title: 'Best-start conditions',
      target: 'along-route',
      placementTarget: 'run-card',
      coachmarkAlignment: 'left',
      coachmarkGap: 12,
      relatedTargets: [],
      message:
        'Your briefing and estimated finish describe the time shown above. The map follows the same run.',
      actionLabel,
    };
  }
  if (step === 'day-outlook') {
    return {
      progress,
      title: 'Day outlook',
      target: 'day-outlook',
      coachmarkMode: 'bottom-docked',
      relatedTargets: [],
      message:
        'Try another time to see how its conditions compare with the recommended start that day.',
      actionLabel,
    };
  }
  return {
    progress,
    title: 'Route watch',
    target: 'watch-route',
    coachmarkMode: 'bottom-docked',
    relatedTargets: [],
    message: 'Choose a schedule and get an alert when conditions line up.',
    actionLabel,
  };
}

export function introductionProgressDotStates(
  step: Exclude<IntroductionStep, 'invite'>,
): boolean[] {
  const currentIndex = INTRODUCTION_GUIDED_STEPS.indexOf(step);
  return INTRODUCTION_GUIDED_STEPS.map((_, index) => index <= currentIndex);
}

export function introductionStepBelongsToSurface(
  step: Exclude<IntroductionStep, 'invite'>,
  surface: IntroductionSurface,
): boolean {
  return step === 'day-outlook' || step === 'watch'
    ? surface === 'planner'
    : surface === 'explorer';
}

export function nextIntroductionStep(step: IntroductionStep): IntroductionStep | null {
  return (
    {
      invite: 'route',
      route: 'start-time',
      'start-time': 'pace',
      pace: 'conditions',
      conditions: 'day-outlook',
      'day-outlook': 'watch',
      watch: null,
    } as const
  )[step];
}

export function previousIntroductionStep(step: IntroductionStep): IntroductionStep | null {
  return (
    {
      invite: null,
      route: 'invite',
      'start-time': 'route',
      pace: 'start-time',
      conditions: 'pace',
      'day-outlook': 'conditions',
      watch: 'day-outlook',
    } as const
  )[step];
}

export function placeIntroductionCoachmark(input: {
  target: WindowRect;
  placementTarget?: WindowRect;
  coachmarkWidth: number;
  coachmarkHeight: number;
  windowWidth: number;
  windowHeight: number;
  insetTop: number;
  insetBottom: number;
  margin?: number;
  gap?: number;
  horizontalAlignment?: 'center' | 'left';
}): CoachmarkPlacement {
  const margin = input.margin ?? 16;
  const gap = input.gap ?? 24;
  const placementTarget = input.placementTarget ?? input.target;
  const targetCenter = input.target.x + input.target.width / 2;
  const placementCenter = placementTarget.x + placementTarget.width / 2;
  const unclampedLeft =
    input.horizontalAlignment === 'left'
      ? placementTarget.x
      : placementCenter - input.coachmarkWidth / 2;
  const left = Math.min(
    Math.max(unclampedLeft, margin),
    Math.max(margin, input.windowWidth - input.coachmarkWidth - margin),
  );
  const roomAbove = placementTarget.y - input.insetTop - margin;
  const roomBelow =
    input.windowHeight - input.insetBottom - (placementTarget.y + placementTarget.height) - margin;
  const side =
    roomAbove >= input.coachmarkHeight + gap || roomAbove >= roomBelow ? 'above' : 'below';
  const unclampedTop =
    side === 'above'
      ? placementTarget.y - input.coachmarkHeight - gap
      : placementTarget.y + placementTarget.height + gap;
  const minTop = input.insetTop + margin;
  const maxTop = Math.max(
    minTop,
    input.windowHeight - input.insetBottom - input.coachmarkHeight - margin,
  );
  const top = Math.min(Math.max(unclampedTop, minTop), maxTop);
  const pointerLeft = Math.min(
    Math.max(targetCenter - left - 6, 18),
    Math.max(18, input.coachmarkWidth - 30),
  );
  return { left, top, side, pointerLeft };
}

export function placeIntroductionDockedCoachmark(input: {
  coachmarkWidth: number;
  coachmarkHeight: number;
  windowWidth: number;
  windowHeight: number;
  insetTop: number;
  insetBottom: number;
  margin?: number;
}): DockedCoachmarkPlacement {
  const margin = input.margin ?? 16;
  const left = Math.max(margin, (input.windowWidth - input.coachmarkWidth) / 2);
  const top = Math.max(
    input.insetTop + margin,
    input.windowHeight - input.insetBottom - input.coachmarkHeight - margin,
  );
  return { left, top };
}
