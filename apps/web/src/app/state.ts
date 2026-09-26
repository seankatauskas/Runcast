/**
 * Committed application state. Weather is fetched once per route (3 days of
 * hourly data); everything the start-time slider does is a pure, synchronous
 * planning evaluation over that cache, so recomputation happens in render via
 * useMemo — no debounce, no spinner, no async gap while dragging.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  adaptLegacyRoute,
  DEMO_ROUTES,
  evaluateRunV3,
  evaluateRunWithProfile,
  fetchNormalizedRouteForecast,
  planningRouteIsOutAndBack,
  reverseCanopyEvidence,
  parsePlanningGpx,
  recommendStartV3,
  type EvaluatedRunV3,
  type CanopyEvidenceProfile,
  type RouteConditionsProfile,
  type FetchedRouteForecast,
  type PlanningRoute,
  type StartRecommendationV3,
  type UnitSystem,
  type WoodlandEvidenceProfile,
} from '@runcast/core';
import {
  reverseNormalizedRouteForecast,
  reversePlanningRoute,
  reverseWoodlandEvidenceProfile,
} from '@runcast/core';
import { fetchWoodlandEvidence } from './woodlandEvidence';

export type WeatherStatus = 'loading' | 'ready' | 'error';
export type Theme = 'light' | 'dark';

export interface RouteEntry {
  planningRoute: PlanningRoute;
  canopyEvidence?: CanopyEvidenceProfile;
  woodlandEvidence: WoodlandEvidenceProfile;
  isDemo: boolean;
}

function unknownWoodland(distanceM: number): WoodlandEvidenceProfile {
  return {
    schemaVersion: 2,
    values: Array.from({ length: Math.ceil(distanceM / 30) + 1 }, () => 'unknown'),
    resolutionM: 30,
    source: 'not-fetched',
    fetchedAt: null,
    parserVersion: 'unknown',
    completeness: 'unknown',
    confidence: null,
    reasons: ['coverage.unknown'],
  };
}

const DEFAULT_SPEED = 3.03; // m/s ≈ 5:30 min/km ≈ 8:51 min/mi

/** Next quarter-hour from now — a sane default start. */
function nextQuarterHour(): number {
  const q = 15 * 60 * 1000;
  return Math.ceil(Date.now() / q) * q;
}

function initialTheme(): Theme {
  const stored = localStorage.getItem('runcast-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface Planner {
  routes: RouteEntry[];
  selected: RouteEntry;
  selectRoute: (id: string) => void;
  uploadGpx: (file: File) => Promise<void>;
  uploadError: string | null;

  /** The selected route in its current direction — what the map and plan use. */
  activePlanningRoute: PlanningRoute;
  reversed: boolean;
  /** False for out-and-backs, where reversal is a geometric no-op. */
  canReverse: boolean;
  toggleReverse: () => void;

  startTime: number;
  setStartTime: (t: number) => void;
  sliderWindow: { min: number; max: number };
  speed: number;
  setSpeed: (s: number) => void;

  weatherStatus: WeatherStatus;
  retryWeather: () => void;
  timezone: string | undefined;
  routeConditionsProfile: RouteConditionsProfile | null;
  evaluatedRun: EvaluatedRunV3 | null;
  recommendation: StartRecommendationV3 | null;

  /** Highlight the out-of-sun stretches on the map. */
  shadeHighlight: boolean;
  toggleShadeHighlight: () => void;

  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
  theme: Theme;
  toggleTheme: () => void;
}

export function usePlanner(): Planner {
  const [routes, setRoutes] = useState<RouteEntry[]>(() =>
    DEMO_ROUTES.map((d) => ({
      planningRoute: adaptLegacyRoute(d.route),
      canopyEvidence: d.canopyEvidence,
      woodlandEvidence: unknownWoodland(d.route.totalDistance),
      isDemo: true,
    })),
  );
  const [selectedId, setSelectedId] = useState(routes[0].planningRoute.id);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shadeHighlight, setShadeHighlight] = useState(false);
  const [reversedIds, setReversedIds] = useState<ReadonlySet<string>>(new Set());

  // A highlight describes one route's plan; don't carry it to another.
  function selectRoute(id: string): void {
    setSelectedId(id);
    setShadeHighlight(false);
  }

  const [startTime, setStartTime] = useState(nextQuarterHour);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [units, setUnits] = useState<UnitSystem>('imperial');
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const [weather, setWeather] = useState<FetchedRouteForecast | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('loading');
  const [fetchNonce, setFetchNonce] = useState(0);

  const selected = routes.find((entry) => entry.planningRoute.id === selectedId) ?? routes[0];
  const reversed = reversedIds.has(selected.planningRoute.id);

  const canReverse = useMemo(
    () => !planningRouteIsOutAndBack(selected.planningRoute),
    [selected.planningRoute],
  );

  // Reversal is applied to the plan's inputs, not the cached fetches: the
  // weather effect below stays keyed on the base route, so toggling never
  // touches the network.
  const activePlanningRoute = useMemo(
    () => (reversed ? reversePlanningRoute(selected.planningRoute) : selected.planningRoute),
    [selected.planningRoute, reversed],
  );
  const activeCanopy = useMemo(
    () =>
      selected.canopyEvidence && reversed
        ? reverseCanopyEvidence(selected.canopyEvidence, selected.planningRoute.totalDistanceM)
        : selected.canopyEvidence,
    [selected, reversed],
  );
  const activeWoodlandEvidence = useMemo(
    () =>
      reversed
        ? reverseWoodlandEvidenceProfile(
            selected.woodlandEvidence,
            selected.planningRoute.totalDistanceM,
          )
        : selected.woodlandEvidence,
    [selected.woodlandEvidence, selected.planningRoute.totalDistanceM, reversed],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('runcast-theme', theme);
  }, [theme]);

  // One weather fetch per route (or per explicit retry).
  const routeForWeather = selected.planningRoute;
  useEffect(() => {
    const controller = new AbortController();
    setWeatherStatus('loading');
    setWeather(null);
    fetchNormalizedRouteForecast(routeForWeather, controller.signal)
      .then((w) => {
        setWeather(w);
        setWeatherStatus('ready');
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('weather fetch failed', err);
        setWeatherStatus('error');
      });
    return () => controller.abort();
  }, [routeForWeather, fetchNonce]);

  // The slider spans the fetched forecast: now-ish to +47 h.
  const sliderWindow = useMemo(() => {
    const min = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    return { min, max: min + 47 * 3_600_000 };
  }, []);

  const activeForecast = useMemo(() => {
    if (!weather) return null;
    return reversed
      ? reverseNormalizedRouteForecast(weather.field, selected.planningRoute.totalDistanceM)
      : weather.field;
  }, [weather, reversed, selected.planningRoute.totalDistanceM]);

  const candidateAssessment = useMemo(() => {
    if (!activeForecast) return null;
    return evaluateRunWithProfile({
      route: activePlanningRoute,
      forecast: activeForecast,
      woodlandEvidence: activeWoodlandEvidence,
      canopyEvidence: activeCanopy,
      canopyModelMode: 'active',
      startTime,
      expectedFlatSpeedMs: speed,
    });
  }, [activeForecast, activePlanningRoute, activeWoodlandEvidence, activeCanopy, speed, startTime]);

  const evaluatedRun = candidateAssessment?.assessment.plan ?? null;
  const routeConditionsProfile = candidateAssessment?.profile ?? null;
  const [decisionTime] = useState(Date.now);

  const recommendation = useMemo(() => {
    if (!activeForecast) return null;
    return recommendStartV3({
      windowStart: sliderWindow.min,
      windowEnd: sliderWindow.max,
      decisionTime,
      minimumNoticeMs: 0,
      validFrom: activeForecast.validFrom,
      validUntil: activeForecast.validUntil,
      inputIdentity: {
        routeId: activePlanningRoute.id,
        forecast: activeForecast.contentHash,
        // Compatibility identity key: changing it would invalidate existing hashes.
        coverage: activeWoodlandEvidence,
        expectedFlatSpeedMs: speed,
        canopy: activeCanopy ?? null,
        canopyModelMode: 'active',
      },
      evaluate: (candidateStart) =>
        evaluateRunV3({
          route: activePlanningRoute,
          forecast: activeForecast,
          woodlandEvidence: activeWoodlandEvidence,
          canopyEvidence: activeCanopy,
          canopyModelMode: 'active',
          startTime: candidateStart,
          expectedFlatSpeedMs: speed,
        }),
    });
  }, [
    activeForecast,
    activePlanningRoute,
    activeWoodlandEvidence,
    activeCanopy,
    decisionTime,
    speed,
    sliderWindow,
  ]);

  const uploadSeq = useRef(0);
  async function uploadGpx(file: File): Promise<void> {
    setUploadError(null);
    try {
      const id = `upload-${++uploadSeq.current}`;
      const planningRoute = parsePlanningGpx(
        await file.text(),
        id,
        file.name.replace(/\.gpx$/i, ''),
      );
      const initialWoodlandEvidence = unknownWoodland(planningRoute.totalDistanceM);
      // Show the route immediately with unknown coverage; refine when
      // (if) Overpass answers.
      setRoutes((rs) => [
        ...rs.filter((r) => r.isDemo),
        {
          planningRoute,
          woodlandEvidence: initialWoodlandEvidence,
          isDemo: false,
        },
      ]);
      setSelectedId(id);
      setShadeHighlight(false);
      fetchWoodlandEvidence(planningRoute).then((woodlandEvidence) => {
        setRoutes((rs) =>
          rs.map((r) =>
            r.planningRoute.id === id
              ? {
                  ...r,
                  woodlandEvidence,
                }
              : r,
          ),
        );
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  }

  function toggleReverse(): void {
    const id = selected.planningRoute.id;
    setReversedIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return {
    routes,
    selected,
    selectRoute,
    uploadGpx,
    uploadError,
    activePlanningRoute,
    reversed,
    canReverse,
    toggleReverse,
    startTime,
    setStartTime,
    sliderWindow,
    speed,
    setSpeed,
    weatherStatus,
    retryWeather: () => setFetchNonce((n) => n + 1),
    timezone: weather?.timezone,
    routeConditionsProfile,
    evaluatedRun,
    recommendation,
    shadeHighlight,
    toggleShadeHighlight: () => setShadeHighlight((v) => !v),
    units,
    setUnits,
    theme,
    toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
  };
}
