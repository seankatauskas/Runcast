import type {
  buildRouteTiming,
  EvaluatedRunV3,
  RouteConditionsProfile,
  WeatherAlert,
} from '@runcast/core';
import { normalizePlannerStartTime } from './plannerClock';

export interface RunDisplayContext {
  startTime: number;
  timing: ReturnType<typeof buildRouteTiming>;
  plan: EvaluatedRunV3 | null;
  profile: RouteConditionsProfile | null;
  alerts: WeatherAlert[];
  unavailableReasons: string[];
}

export interface RunStartSelection {
  mode: 'recommended' | 'selected';
  selected: number;
  preview: number | null;
}
export type RunStartAction =
  | { type: 'commit'; start: number }
  | { type: 'preview'; start: number | null }
  | { type: 'route' }
  | { type: 'clock'; now: number };

/** Selection intent survives navigation; previews never overwrite a committed choice. */
export function runStartReducer(
  state: RunStartSelection,
  action: RunStartAction,
): RunStartSelection {
  switch (action.type) {
    case 'commit':
      return { mode: 'selected', selected: action.start, preview: null };
    case 'preview':
      return { ...state, preview: action.start };
    case 'route':
      return { ...state, mode: 'recommended', preview: null };
    case 'clock': {
      const selected = normalizePlannerStartTime(state.selected, action.now);
      const preview = state.preview !== null && state.preview < action.now ? null : state.preview;
      return selected === state.selected && preview === state.preview
        ? state
        : { ...state, selected, preview };
    }
  }
}

export function resolveRunStart(
  state: RunStartSelection,
  recommendation: number | null,
  now: number,
) {
  const committedStartTime = normalizePlannerStartTime(
    state.mode === 'recommended' ? (recommendation ?? state.selected) : state.selected,
    now,
  );
  return { committedStartTime, startTime: state.preview ?? committedStartTime };
}
