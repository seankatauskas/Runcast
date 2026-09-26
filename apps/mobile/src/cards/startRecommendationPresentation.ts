import {
  presentRunConditions,
  type StartRecommendationV3,
  type StartRecommendationStatus,
} from '@runcast/core';
import type { PlanningBundleSyncState } from '../data/planningBundleSync';

export type PlanningSurfaceMode = 'ready' | 'loading' | 'unavailable';

/** Current planning output is authoritative; legacy display availability must never gate it. */
export function planningSurfaceMode(input: {
  hasEvaluatedRun: boolean;
  weatherStatus: 'loading' | 'ready' | 'error';
  syncState: PlanningBundleSyncState | null;
  environmentExpired: boolean;
}): PlanningSurfaceMode {
  if (input.hasEvaluatedRun) return 'ready';
  if (input.weatherStatus === 'loading' && input.syncState === null && !input.environmentExpired) {
    return 'loading';
  }
  return 'unavailable';
}

const REASON_LABELS: Record<string, string> = {
  'safety.thunderstorm': 'Thunderstorms affect every evaluated start.',
  'safety.heavy-rain': 'Heavy rain is possible during this run.',
  'safety.extreme-heat': 'Forecast heat reaches the caution threshold.',
  'safety.high-wind': 'Forecast gusts reach the caution threshold.',
  'weather.outside-validity': 'The saved forecast has expired.',
  'weather.missing-critical-field': 'A required forecast value is missing.',
  'recommendation.finish-outside-validity': 'The run would finish beyond forecast validity.',
  'recommendation.schedule-unavailable':
    'No scheduled starts in this forecast. Choose a time or edit your running schedule.',
  'recommendation.input-unavailable': 'Required planning inputs are unavailable.',
  'recommendation.no-suitable-window': 'Every evaluated start is blocked.',
  'compatibility.reader-unsupported': 'Update Runcast to read the latest planning data.',
  'bundle.preparing': 'The route forecast is still being prepared.',
};

export interface StartRecommendationPresentation {
  status: StartRecommendationStatus;
  label: string;
  title: string;
  detail: string;
  winnerStartTime: number | null;
  reasons: Array<{ code: string; label: string }>;
}

export function recommendationReasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/[.-]/g, ' ');
}

export function planningUnavailableMessage(input: {
  weatherStatus: 'loading' | 'ready' | 'error';
  syncState: PlanningBundleSyncState | null;
  environmentExpired: boolean;
  reasons: readonly string[];
}): string {
  if (input.environmentExpired) {
    return 'Forecast expired. Route geometry and timing remain available.';
  }
  if (input.syncState === 'preparing') return 'The route forecast is still being prepared.';
  if (input.syncState === 'update-required') {
    return 'Update Runcast to read this route’s planning data.';
  }
  if (input.weatherStatus === 'error') {
    return 'Forecast unavailable. Check your connection and try again.';
  }
  if (input.reasons.length) return recommendationReasonLabel(input.reasons[0]);
  return 'Run conditions cannot be evaluated from the available forecast.';
}

export function startRecommendationPresentation(input: {
  recommendation: Pick<StartRecommendationV3, 'status' | 'winner' | 'reasons'> | null;
  unavailableReasons: readonly string[];
  syncState: PlanningBundleSyncState | null;
  environmentExpired: boolean;
}): StartRecommendationPresentation {
  const recommendation = input.recommendation;
  const winnerConditions = recommendation?.winner?.plan
    ? presentRunConditions(recommendation.winner.plan)
    : null;
  const status = recommendation?.status ?? 'unavailable';
  const reasons = [...new Set(recommendation?.reasons ?? input.unavailableReasons)].map((code) => ({
    code,
    label: recommendationReasonLabel(code),
  }));
  if (status === 'recommended') {
    return {
      status,
      label: 'BEST TIME TO RUN',
      title: 'Best eligible start',
      detail: winnerConditions
        ? `${winnerConditions.overallLabel} run conditions`
        : 'Best eligible forecast conditions',
      winnerStartTime: recommendation?.winner?.startTime ?? null,
      reasons,
    };
  }
  if (status === 'caution') {
    return {
      status,
      label: 'BEST AVAILABLE TIME',
      title: 'Best available start has cautions',
      detail: 'Review the forecast factors before choosing this time.',
      winnerStartTime: recommendation?.winner?.startTime ?? null,
      reasons,
    };
  }
  if (status === 'no-suitable-window') {
    return {
      status,
      label: 'NO SUITABLE WINDOW',
      title: 'No selectable start in this window',
      detail: 'Every evaluated candidate is blocked by the planning policy.',
      winnerStartTime: null,
      reasons,
    };
  }
  if (reasons.some((reason) => reason.code === 'recommendation.schedule-unavailable')) {
    return {
      status,
      label: 'NO SCHEDULED START',
      title: 'No scheduled start in this forecast',
      detail: 'Choose a time manually or edit your running schedule.',
      winnerStartTime: null,
      reasons,
    };
  }
  const preparing = input.syncState === 'preparing';
  const updateRequired = input.syncState === 'update-required';
  return {
    status,
    label: preparing ? 'PREPARING' : updateRequired ? 'UPDATE REQUIRED' : 'UNAVAILABLE',
    title: preparing
      ? 'Forecast preparation is in progress'
      : input.environmentExpired
        ? 'Environmental recommendation expired'
        : updateRequired
          ? 'A client update is required'
          : 'Environmental recommendation unavailable',
    detail: input.environmentExpired
      ? 'Route geometry and timing remain available.'
      : 'No environmental recommendation can be made from current inputs.',
    winnerStartTime: null,
    reasons,
  };
}
