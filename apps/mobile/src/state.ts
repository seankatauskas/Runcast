/** Planner composition: route transitions, preference persistence, and current evaluation. */
import { runStartReducer, resolveRunStart, type RunDisplayContext } from './data/runDisplayContext';
import { recommendationForStartDay } from './cards/prerunBriefingModel';
import { weeklyStartScheduleSchema } from '@runcast/contracts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, useColorScheme } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  adaptPlannableRouteV1,
  buildRouteTiming,
  evaluateRunWithProfile,
  forecastIsFresh,
  hoverBus,
  isClosedLoop,
  isOutAndBack,
  parsePlanningGpx,
  routeGeometryIdentity,
  recommendStartV3,
  reverseCanopyEvidence,
  reverseRoute,
  reverseNormalizedRouteForecast,
  reversePlanningRoute,
  reverseWoodlandEvidenceProfile,
  unknownMask,
  type AlertKind,
  type CanopyModelMode,
  type EvaluatedRunV3,
  type NormalizedRouteForecast,
  type PlanningRoute,
  type Route,
  type RouteConditionsProfile,
  type StartRecommendationV3,
  type TemperatureUnit,
  type UnitSystem,
  type WeatherAlert,
  type WeeklyStartSchedule,
} from '@runcast/core';
import type { PreferenceValues } from './data/preferences';
import type { CachedCloudRoute } from './data/cloudRoutes';
import { resolveClientCanopyModelMode } from './data/environmentPolicy';
import { planningBundleIsEnvironmentallyValid } from './data/planningBundle';
import type { PlanningBundleSyncState } from './data/planningBundleSync';
import {
  nextStrictQuarterHour,
  normalizePlannerStartTime,
  plannerRecommendationWindow,
  plannerSliderWindow,
  startPlannerClock,
} from './data/plannerClock';
import {
  legacyCoverageAsWoodlandEvidence,
  woodlandEvidenceForLegacyPresentation,
} from './data/compatibility/legacyPlanningAdapters';
import {
  RouteForecastRefreshes,
  forecastRefreshFailed,
  forecastRefreshStarted,
  type ForecastCacheEntry,
} from './data/routeForecastRefresh';
import { acquireWoodlandEvidenceForRoute } from './data/woodland/acquireWoodlandEvidence';
import { DARK, LIGHT, type Chrome } from './theme';
import {
  deleteStoredLocalRoute,
  renameStoredLocalRoute,
  storedLocalRoutes,
  storeLocalRoute,
  updateStoredLocalRouteEnvironment,
  type StoredLocalRoute,
} from './data/routeLibrary';
import { normalizedRouteName } from './data/routeLibraryModel';
import { safetyAlerts } from './data/planningPresentation';
import { E2E_BUILD_ENABLED, e2eRouteIdForImport, fetchRouteForecast } from './e2e/runtime';
import { initialPlannerRoutes, plannerRoutesReducer, type RouteEntry } from './data/plannerRoutes';
import {
  initialPlannerPreferences,
  plannerPreferencesReducer,
  PlannerPreferenceWrites,
  readPlannerPreferences,
} from './data/plannerPreferences';
import { isValidAcceptableStartWindow } from './data/acceptableStartWindow';

export type { RouteEntry } from './data/plannerRoutes';
export type WeatherStatus = 'loading' | 'ready' | 'error';
export type ThemeName = 'light' | 'dark';
export type ThemePreference = ThemeName | 'system';
export type RefreshPlanningBundle = (routeId: string) => Promise<void>;
type WeatherCacheEntry = ForecastCacheEntry<NormalizedRouteForecast>;
const STORE_KEY = 'runcast-prefs';
const ALERT_WORSENING_DELTA: Record<AlertKind, number> = {
  thunderstorm: 0,
  'heavy-rain': 3,
  'extreme-heat': 2,
  'high-wind': 5,
};
interface AlertExpansion {
  routeId: string;
  peaks: Partial<Record<AlertKind, number>>;
}

function expansionCovers(
  expansion: AlertExpansion,
  routeId: string,
  alerts: WeatherAlert[],
): boolean {
  if (expansion.routeId !== routeId || alerts.length === 0) return false;
  return alerts.every((alert) => {
    const expandedPeak = expansion.peaks[alert.kind];
    if (alert.kind === 'thunderstorm') return expandedPeak !== undefined;
    return (
      expandedPeak !== undefined && alert.peak < expandedPeak + ALERT_WORSENING_DELTA[alert.kind]
    );
  });
}

export interface Planner {
  routes: RouteEntry[];
  selected: RouteEntry;
  selectRoute: (id: string) => void;
  importGpx: (
    xml: string,
    filename: string,
  ) => Promise<{ status: 'created' | 'duplicate'; routeId: string; name: string }>;
  renameRoute: (id: string, name: string) => Promise<string>;
  deleteRoute: (id: string) => Promise<void>;
  replaceCloudRoutes: (routes: CachedCloudRoute[], ownerId: string | null) => void;
  importError: string | null;

  /** The selected route in its current direction — what the map and plan use. */
  activeLegacyRoute: Route;
  reversed: boolean;
  /** False for out-and-backs, where reversal is a geometric no-op. */
  canReverse: boolean;
  toggleReverse: () => void;

  /** One absolute instant, formatted in the selected route's local timezone. */
  startTime: number;
  setStartTime: (t: number) => void;
  previewStartTime: (t: number | null) => void;
  committedStartTime: number;
  startSelectionMode: 'recommended' | 'selected';
  displayContext: RunDisplayContext;
  sliderWindow: { min: number; max: number };
  speed: number;
  setSpeed: (s: number) => void;

  weatherStatus: WeatherStatus;
  retryWeather: () => void;
  timezone: string | undefined;
  evaluatedRun: EvaluatedRunV3 | null;
  routeConditionsProfile: RouteConditionsProfile | null;
  planningUnavailableReasons: string[];
  routeTiming: ReturnType<typeof buildRouteTiming>;
  startRecommendation: StartRecommendationV3 | null;
  startRecommendationUnavailableReasons: string[];
  planningBundleSyncState: PlanningBundleSyncState | null;
  environmentExpired: boolean;

  /** Safety alerts for the same run as the map and briefing. */
  weatherAlerts: WeatherAlert[];
  weatherAlertsCollapsed: boolean;
  collapseWeatherAlerts: () => void;
  expandWeatherAlerts: () => void;

  /** Highlight Current possible-shade and after-sunset stretches on the map. */
  shadeHighlight: boolean;
  toggleShadeHighlight: () => void;

  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
  temperatureUnit: TemperatureUnit;
  setTemperatureUnit: (u: TemperatureUnit) => void;
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
  acceptableStartMinutes: number;
  acceptableEndMinutes: number;
  weeklyStartSchedule: WeeklyStartSchedule | null;
  setWeeklyStartSchedule: (schedule: WeeklyStartSchedule) => void;
  setAcceptableStartWindow: (startMinutes: number, endMinutes: number) => void;
  themeName: ThemeName;
  chrome: Chrome;
  applyRemotePreferences: (preferences: PreferenceValues) => void;
}

function usePlannerState(refreshPlanningBundle?: RefreshPlanningBundle): Planner {
  const [library, dispatchRoutes] = useReducer(
    plannerRoutesReducer,
    undefined,
    initialPlannerRoutes,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const { routes, selectedId, reversedIds } = library;
  const selected = routes.find((entry) => entry.legacyRoute.id === selectedId) ?? routes[0];
  const [importError, setImportError] = useState<string | null>(null);
  const [shadeHighlight, setShadeHighlight] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now);
  const [runStart, dispatchRunStart] = useReducer(runStartReducer, {
    mode: 'recommended',
    selected: nextStrictQuarterHour(Date.now()),
    preview: null,
  });
  const [preferenceState, dispatchPreferences] = useReducer(
    plannerPreferencesReducer,
    initialPlannerPreferences,
  );
  const preferences = preferenceState.values;
  const {
    units,
    temperatureUnit,
    acceptableStartMinutes,
    acceptableEndMinutes,
    defaultSpeed: speed,
    weeklyStartSchedule = null,
  } = preferences;
  const preferenceWrites = useRef(
    new PlannerPreferenceWrites((raw) => AsyncStorage.setItem(STORE_KEY, raw)),
  );
  const [weatherCache, setWeatherCache] = useState<Record<string, WeatherCacheEntry>>({});
  const weatherRefreshes = useRef(new RouteForecastRefreshes());
  const woodlandControllers = useRef(new Map<string, AbortController>());
  const [alertExpansion, setAlertExpansion] = useState<AlertExpansion | null>(null);
  const systemScheme = useColorScheme();
  const themeName: ThemeName =
    preferences.theme === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : preferences.theme;

  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (live) dispatchPreferences({ type: 'hydrate', values: readPlannerPreferences(raw) });
      })
      .catch(() => {
        if (live) dispatchPreferences({ type: 'hydrate', values: readPlannerPreferences(null) });
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!preferenceState.hydrated && preferenceState.revision === 0) return;
    void preferenceWrites.current
      .enqueue(preferences)
      .catch((error) => console.error('preference persistence failed', error));
  }, [preferences, preferenceState.hydrated, preferenceState.revision]);
  const setUnits = useCallback(
    (units: UnitSystem) => dispatchPreferences({ type: 'edit', patch: { units } }),
    [],
  );
  const setSpeed = useCallback(
    (defaultSpeed: number) => dispatchPreferences({ type: 'edit', patch: { defaultSpeed } }),
    [],
  );
  const setTemperatureUnit = useCallback(
    (temperatureUnit: TemperatureUnit) =>
      dispatchPreferences({ type: 'edit', patch: { temperatureUnit } }),
    [],
  );
  const setThemePreference = useCallback(
    (theme: ThemePreference) => dispatchPreferences({ type: 'edit', patch: { theme } }),
    [],
  );
  const setAcceptableStartWindow = useCallback((startMinutes: number, endMinutes: number) => {
    if (!isValidAcceptableStartWindow(startMinutes, endMinutes))
      throw new RangeError('Acceptable start window is invalid');
    dispatchPreferences({
      type: 'edit',
      patch: {
        acceptableStartMinutes: startMinutes,
        acceptableEndMinutes: endMinutes,
        weeklyStartSchedule: null,
      },
    });
  }, []);
  const setWeeklyStartSchedule = useCallback((schedule: WeeklyStartSchedule) => {
    dispatchPreferences({
      type: 'edit',
      patch: { weeklyStartSchedule: weeklyStartScheduleSchema.parse(schedule) },
    });
  }, []);
  const applyRemotePreferences = useCallback(
    (values: PreferenceValues) => dispatchPreferences({ type: 'remote', values }),
    [],
  );

  const setStartTime = useCallback(
    (selection: number) =>
      dispatchRunStart({ type: 'commit', start: normalizePlannerStartTime(selection, Date.now()) }),
    [],
  );
  const previewStartTime = useCallback(
    (start: number | null) => dispatchRunStart({ type: 'preview', start }),
    [],
  );
  useEffect(
    () =>
      startPlannerClock(
        {
          now: Date.now,
          currentAppState: () => AppState.currentState,
          setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
          clearTimer: (timer) => clearTimeout(timer),
          subscribeAppState: (listener) =>
            AppState.addEventListener('change', (state) => listener(state)),
        },
        (now) => {
          setCurrentTime(now);
          dispatchRunStart({ type: 'clock', now });
        },
      ),
    [],
  );

  const hydrateLocalRoutes = useCallback(async (ownerId = libraryRef.current.ownerId) => {
    const startedAtRevision = libraryRef.current.revision;
    const stored = await storedLocalRoutes();
    if (mounted.current)
      dispatchRoutes({ type: 'hydrate', routes: stored, startedAtRevision, ownerId });
  }, []);
  useEffect(() => {
    void hydrateLocalRoutes().catch((error) => {
      console.error('route library hydration failed', error);
      if (mounted.current) setImportError('Saved routes could not be loaded from this device.');
    });
  }, [hydrateLocalRoutes]);

  const replaceCloudRoutes = useCallback(
    (cloudRoutes: CachedCloudRoute[], ownerId: string | null) => {
      dispatchRoutes({ type: 'cloud', routes: cloudRoutes, ownerId });
      void hydrateLocalRoutes(ownerId).catch((error) =>
        console.error('route library hydration failed', error),
      );
    },
    [hydrateLocalRoutes],
  );

  const canReverse = useMemo(
    () => isClosedLoop(selected.legacyRoute) && !isOutAndBack(selected.legacyRoute),
    [selected.legacyRoute],
  );
  const reversed = canReverse && reversedIds.has(selected.legacyRoute.id);
  const activeLegacyRoute = useMemo(
    () => (reversed ? reverseRoute(selected.legacyRoute) : selected.legacyRoute),
    [selected.legacyRoute, reversed],
  );
  const activePlanningRoute = useMemo(
    () => (reversed ? reversePlanningRoute(selected.planningRoute) : selected.planningRoute),
    [selected.planningRoute, reversed],
  );
  const activeWoodlandEvidence = useMemo(
    () =>
      reversed
        ? reverseWoodlandEvidenceProfile(
            selected.woodlandEvidence,
            selected.planningRoute.totalDistanceM,
          )
        : selected.woodlandEvidence,
    [reversed, selected.woodlandEvidence, selected.planningRoute.totalDistanceM],
  );
  const activeCanopyEvidence = useMemo(
    () =>
      reversed && selected.canopyEvidence
        ? reverseCanopyEvidence(selected.canopyEvidence, selected.planningRoute.totalDistanceM)
        : selected.canopyEvidence,
    [reversed, selected.canopyEvidence, selected.planningRoute.totalDistanceM],
  );
  const canopyModelMode: CanopyModelMode =
    selected.planningBundle?.bundle.manifest.canopyModelMode ??
    (selected.isDemo
      ? resolveClientCanopyModelMode(process.env.EXPO_PUBLIC_CANOPY_MODEL_MODE)
      : 'off');

  const fetchRouteWeather = useCallback(
    (route: PlanningRoute): Promise<void> =>
      weatherRefreshes.current.run(route.id, async (signal) => {
        if (signal.aborted) return;
        setWeatherCache((cache) => ({
          ...cache,
          [route.id]: forecastRefreshStarted(cache[route.id]),
        }));
        try {
          const { field: forecast, timezone } = await fetchRouteForecast(route, signal);
          if (signal.aborted) return;
          setWeatherCache((cache) => ({
            ...cache,
            [route.id]: { status: 'ready', forecast, timezone, error: null },
          }));
        } catch (error) {
          if (signal.aborted) return;
          setWeatherCache((cache) => ({
            ...cache,
            [route.id]: forecastRefreshFailed(cache[route.id], error),
          }));
        }
      }),
    [],
  );
  useEffect(() => {
    const directIds = new Set(
      routes
        .filter((route) => !route.origin.startsWith('cloud-'))
        .map((route) => route.legacyRoute.id),
    );
    weatherRefreshes.current.retain(directIds);
    for (const [id, controller] of woodlandControllers.current) {
      if (!directIds.has(id)) {
        controller.abort();
        woodlandControllers.current.delete(id);
      }
    }
    setWeatherCache((cache) => {
      const next = Object.fromEntries(Object.entries(cache).filter(([id]) => directIds.has(id)));
      return Object.keys(next).length === Object.keys(cache).length ? cache : next;
    });
  }, [routes]);
  useEffect(
    () => () => {
      weatherRefreshes.current.retain(new Set());
      woodlandControllers.current.forEach((controller) => controller.abort());
      woodlandControllers.current.clear();
    },
    [],
  );

  const isCloud = selected.origin.startsWith('cloud-');
  const directWeather = weatherCache[selected.legacyRoute.id];
  const forecast = isCloud
    ? (selected.planningBundle?.bundle.forecast.data as NormalizedRouteForecast | undefined)
    : directWeather?.forecast;
  const timezone = selected.timezone ?? directWeather?.timezone ?? undefined;
  const weatherStatus: WeatherStatus = isCloud
    ? selected.planningBundle
      ? 'ready'
      : selected.planningSyncState === 'preparing'
        ? 'loading'
        : 'error'
    : (directWeather?.status ?? 'loading');
  const environmentExpired = Boolean(
    selected.planningBundle &&
    !planningBundleIsEnvironmentallyValid(selected.planningBundle, currentTime),
  );
  useEffect(() => {
    if (!isCloud && !directWeather) void fetchRouteWeather(selected.planningRoute);
  }, [isCloud, directWeather, fetchRouteWeather, selected.planningRoute]);
  useEffect(() => {
    if (forecast?.fetchedAt === undefined || forecastIsFresh(forecast.fetchedAt, currentTime))
      return;
    if (isCloud) void refreshPlanningBundle?.(selected.legacyRoute.id);
    else void fetchRouteWeather(selected.planningRoute);
  }, [
    currentTime,
    forecast?.fetchedAt,
    fetchRouteWeather,
    isCloud,
    refreshPlanningBundle,
    selected.legacyRoute.id,
    selected.planningRoute,
  ]);

  function selectRoute(id: string): void {
    if (id === selectedId) return;
    dispatchRoutes({ type: 'select', id });
  }
  useEffect(() => {
    dispatchRunStart({ type: 'route' });
    setShadeHighlight(false);
    hoverBus.publish({ distance: null, source: 'map' });
  }, [selectedId]);
  const sliderWindow = useMemo(() => plannerSliderWindow(currentTime), [currentTime]);
  const recommendationWindow = useMemo(
    () => plannerRecommendationWindow(currentTime, sliderWindow.max, timezone),
    [currentTime, sliderWindow.max, timezone],
  );
  const zonedAcceptableStartWindow = useMemo(
    () => ({
      startMinutes: acceptableStartMinutes,
      endMinutes: acceptableEndMinutes,
      timezone: timezone ?? 'UTC',
      weeklySchedule: weeklyStartSchedule,
    }),
    [acceptableEndMinutes, acceptableStartMinutes, weeklyStartSchedule, timezone],
  );

  const activeNormalizedForecast = useMemo(() => {
    if (!forecast || environmentExpired) return null;
    return reversed
      ? reverseNormalizedRouteForecast(forecast, selected.planningRoute.totalDistanceM)
      : forecast;
  }, [forecast, environmentExpired, reversed, selected.planningRoute.totalDistanceM]);
  // Availability edits rerank existing assessments; plan and profile share one
  // evaluation for each displayed or recommended start.
  const evaluateRecommendationCandidate = useMemo(() => {
    const cache = new Map<number, ReturnType<typeof evaluateRunWithProfile>>();
    return (candidateStart: number) => {
      const previous = cache.get(candidateStart);
      if (previous) return previous;
      const result = evaluateRunWithProfile({
        route: activePlanningRoute,
        forecast: activeNormalizedForecast!,
        woodlandEvidence: activeWoodlandEvidence,
        canopyEvidence: activeCanopyEvidence ?? undefined,
        canopyModelMode,
        startTime: candidateStart,
        expectedFlatSpeedMs: speed,
      });
      cache.set(candidateStart, result);
      return result;
    };
  }, [
    activePlanningRoute,
    activeNormalizedForecast,
    activeWoodlandEvidence,
    activeCanopyEvidence,
    canopyModelMode,
    speed,
  ]);

  const startRecommendation = useMemo(() => {
    if (!activeNormalizedForecast) return null;
    return recommendStartV3({
      windowStart: recommendationWindow.min,
      windowEnd: recommendationWindow.max,
      decisionTime: currentTime,
      minimumNoticeMs: 0,
      validFrom: activeNormalizedForecast.validFrom,
      validUntil: activeNormalizedForecast.validUntil,
      acceptableStartWindow: zonedAcceptableStartWindow,
      inputIdentity: {
        bundleId: selected.planningBundle?.bundle.manifest.bundleId ?? null,
        routeId: activePlanningRoute.id,
        direction: reversed ? 'reversed' : 'forward',
      },
      evaluate: (candidateStart) => evaluateRecommendationCandidate(candidateStart).assessment,
    });
  }, [
    evaluateRecommendationCandidate,
    activeNormalizedForecast,
    activeWoodlandEvidence,
    activeCanopyEvidence,
    activePlanningRoute,
    currentTime,
    canopyModelMode,
    recommendationWindow,
    reversed,
    selected.planningBundle,
    speed,
    zonedAcceptableStartWindow,
  ]);

  const defaultRecommendation = recommendationForStartDay(
    startRecommendation,
    currentTime,
    zonedAcceptableStartWindow,
    true,
  );
  const { startTime, committedStartTime } = resolveRunStart(
    runStart,
    defaultRecommendation?.winner?.startTime ?? null,
    currentTime,
  );

  const routeTiming = useMemo(
    () => buildRouteTiming(activePlanningRoute, startTime, speed),
    [activePlanningRoute, startTime, speed],
  );
  const selectedEvaluation = useMemo(
    () => (activeNormalizedForecast ? evaluateRecommendationCandidate(startTime) : null),
    [activeNormalizedForecast, evaluateRecommendationCandidate, startTime],
  );
  const evaluatedRun = selectedEvaluation?.assessment.plan ?? null;
  const routeConditionsProfile = selectedEvaluation?.profile ?? null;
  const planningUnavailableReasons = selectedEvaluation?.assessment.plan
    ? []
    : (selectedEvaluation?.assessment.reasons ?? []);
  // Forecast facts and alerts always describe the displayed (including preview) run.
  const weatherAlerts = useMemo(() => safetyAlerts(evaluatedRun), [evaluatedRun]);
  const displayContext = useMemo<RunDisplayContext>(
    () => ({
      startTime,
      timing: routeTiming,
      plan: evaluatedRun,
      profile: routeConditionsProfile,
      alerts: weatherAlerts,
      unavailableReasons: planningUnavailableReasons,
    }),
    [
      startTime,
      routeTiming,
      evaluatedRun,
      routeConditionsProfile,
      weatherAlerts,
      planningUnavailableReasons.join('|'),
    ],
  );
  const weatherAlertsCollapsed =
    weatherAlerts.length > 0 &&
    !(alertExpansion && expansionCovers(alertExpansion, selected.legacyRoute.id, weatherAlerts));

  useEffect(() => {
    if (!alertExpansion) return;
    if (!expansionCovers(alertExpansion, selected.legacyRoute.id, weatherAlerts)) {
      setAlertExpansion(null);
    }
  }, [alertExpansion, selected.legacyRoute.id, weatherAlerts]);

  const collapseWeatherAlerts = useCallback(() => setAlertExpansion(null), []);

  const expandWeatherAlerts = useCallback(() => {
    if (weatherAlerts.length === 0) return;
    setAlertExpansion({
      routeId: selected.legacyRoute.id,
      peaks: Object.fromEntries(weatherAlerts.map((alert) => [alert.kind, alert.peak])),
    });
  }, [selected.legacyRoute.id, weatherAlerts]);

  const startRecommendationUnavailableReasons = startRecommendation
    ? startRecommendation.reasons
    : environmentExpired
      ? ['weather.outside-validity']
      : selected.planningSyncState === 'preparing'
        ? ['bundle.preparing']
        : selected.planningSyncState === 'update-required'
          ? ['compatibility.reader-unsupported']
          : planningUnavailableReasons.length
            ? planningUnavailableReasons
            : ['recommendation.input-unavailable'];

  async function importGpx(
    xml: string,
    filename: string,
  ): Promise<{ status: 'created' | 'duplicate'; routeId: string; name: string }> {
    setImportError(null);
    try {
      const id = e2eRouteIdForImport(xml, filename) ?? Crypto.randomUUID();
      const planningRoute = parsePlanningGpx(xml, id, filename.replace(/\.gpx$/i, ''));
      const geometryIdentity = routeGeometryIdentity(planningRoute);
      const duplicate = libraryRef.current.routes.find(
        (entry) => entry.geometryIdentity === geometryIdentity,
      );
      if (duplicate) {
        selectRoute(duplicate.legacyRoute.id);
        return {
          status: 'duplicate',
          routeId: duplicate.legacyRoute.id,
          name: duplicate.legacyRoute.name,
        };
      }
      const legacyRoute = adaptPlannableRouteV1(planningRoute);
      const legacyCoverage = unknownMask(legacyRoute);
      const now = Date.now();
      const stored: StoredLocalRoute = {
        id,
        name: legacyRoute.name,
        originalGpx: xml,
        geometryIdentity,
        planningRoute,
        legacyRoute,
        legacyCoverage,
        woodlandEvidence: legacyCoverageAsWoodlandEvidence(legacyCoverage, 'not-fetched'),
        origin: 'local',
        createdAt: now,
        updatedAt: now,
      };
      const result = await storeLocalRoute(stored);
      const promoted = libraryRef.current.routes.find(
        (entry) =>
          entry.legacyRoute.id !== result.route.id && entry.geometryIdentity === geometryIdentity,
      );
      if (promoted) {
        if (mounted.current) dispatchRoutes({ type: 'select', id: promoted.legacyRoute.id });
        return {
          status: 'duplicate',
          routeId: promoted.legacyRoute.id,
          name: promoted.legacyRoute.name,
        };
      }
      if (mounted.current) dispatchRoutes({ type: 'import', route: result.route });
      if (result.status === 'created' && !E2E_BUILD_ENABLED && mounted.current) {
        const controller = new AbortController();
        woodlandControllers.current.set(id, controller);
        void acquireWoodlandEvidenceForRoute(planningRoute, controller.signal)
          .then(async (woodlandEvidence) => {
            if (controller.signal.aborted) return;
            const legacyCoverage = woodlandEvidenceForLegacyPresentation(woodlandEvidence);
            await updateStoredLocalRouteEnvironment(id, legacyCoverage, woodlandEvidence);
            if (!controller.signal.aborted)
              dispatchRoutes({
                type: 'environment',
                id,
                geometryIdentity,
                woodlandEvidence,
                now: Date.now(),
              });
          })
          .catch((error) => {
            if (!controller.signal.aborted)
              console.error('route environment persistence failed', error);
          })
          .finally(() => {
            if (woodlandControllers.current.get(id) === controller)
              woodlandControllers.current.delete(id);
          });
      }
      return { status: result.status, routeId: result.route.id, name: result.route.name };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read that file.';
      if (mounted.current) setImportError(message);
      throw new Error(message);
    }
  }
  async function renameRoute(id: string, requestedName: string): Promise<string> {
    const entry = libraryRef.current.routes.find((route) => route.legacyRoute.id === id);
    if (!entry || entry.isDemo) throw new Error('Demo routes cannot be renamed.');
    const name = normalizedRouteName(requestedName);
    if (entry.origin === 'local') await renameStoredLocalRoute(id, name);
    if (mounted.current) dispatchRoutes({ type: 'rename', id, name, now: Date.now() });
    return name;
  }
  async function deleteRoute(id: string): Promise<void> {
    const entry = libraryRef.current.routes.find((route) => route.legacyRoute.id === id);
    if (!entry || entry.isDemo) throw new Error('Demo routes cannot be deleted.');
    if (entry.origin === 'local') await deleteStoredLocalRoute(id);
    woodlandControllers.current.get(id)?.abort();
    if (mounted.current) dispatchRoutes({ type: 'delete', id });
  }
  function toggleReverse(): void {
    if (!canReverse) return;
    dispatchRoutes({ type: 'reverse', id: selected.legacyRoute.id });
    hoverBus.publish({ distance: null, source: 'map' });
  }
  return {
    routes,
    selected,
    selectRoute,
    importGpx,
    renameRoute,
    deleteRoute,
    replaceCloudRoutes,
    importError,
    activeLegacyRoute,
    reversed,
    canReverse,
    toggleReverse,
    startTime,
    setStartTime,
    previewStartTime,
    committedStartTime,
    startSelectionMode: runStart.mode,
    displayContext,
    sliderWindow,
    speed,
    setSpeed,
    weatherStatus,
    retryWeather: () => {
      if (!selected.origin.startsWith('cloud-')) {
        void fetchRouteWeather(selected.planningRoute);
      } else {
        void refreshPlanningBundle?.(selected.legacyRoute.id);
      }
    },
    timezone,
    evaluatedRun,
    routeConditionsProfile,
    planningUnavailableReasons,
    routeTiming,
    startRecommendation,
    startRecommendationUnavailableReasons,
    planningBundleSyncState: selected.planningSyncState,
    environmentExpired,
    weatherAlerts,
    weatherAlertsCollapsed,
    collapseWeatherAlerts,
    expandWeatherAlerts,
    shadeHighlight,
    toggleShadeHighlight: () => setShadeHighlight((v) => !v),
    units,
    setUnits,
    temperatureUnit,
    setTemperatureUnit,
    themePreference: preferences.theme,
    setThemePreference,
    acceptableStartMinutes,
    acceptableEndMinutes,
    weeklyStartSchedule,
    setWeeklyStartSchedule,
    setAcceptableStartWindow,
    themeName,
    chrome: themeName === 'dark' ? DARK : LIGHT,
    applyRemotePreferences,
  };
}

const PlannerContext = createContext<Planner | null>(null);

export function PlannerProvider({
  children,
  refreshPlanningBundle,
}: {
  children: ReactNode;
  refreshPlanningBundle?: RefreshPlanningBundle;
}) {
  const planner = usePlannerState(refreshPlanningBundle);
  return createElement(PlannerContext.Provider, { value: planner }, children);
}

export function usePlanner(): Planner {
  const planner = useContext(PlannerContext);
  if (!planner) throw new Error('usePlanner must be used within PlannerProvider');
  return planner;
}
