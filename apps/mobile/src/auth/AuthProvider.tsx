import {
  authTokensSchema,
  deviceStatusSchema,
  identityStatusSchema,
  preferencesSchema,
  routeImportResultSchema,
  routeListSchema,
  routeSummarySchema,
  stravaAuthorizationResponseSchema,
  watchListResponseSchema,
  watchResultDetailSchema,
  watchResultListResponseSchema,
  type AuthProvider as AuthProviderName,
  type AuthTokens,
  type CreateWatch,
  type NotificationPayload,
  type Preferences,
  type RouteSummary,
  type StravaRoute,
  type Watch,
  type WatchResultDetail,
  type WatchResultSummary,
} from '@runcast/contracts';
import {
  PLANNING_ALGORITHM_VERSION_MANIFEST_V3,
  forecastIsFresh,
  type CoverageMask,
  type Route,
} from '@runcast/core';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { ApiClient, ApiClientError } from '../data/api';
import {
  cachedPlanningBundle,
  cachedCloudRoutes,
  cachedCloudRoute,
  putCloudRoute,
  readPendingPreferences,
  replacePendingPreferences,
  clearPendingPreferences,
  acknowledgePreferences,
  completeMutation,
  conflictMutation,
  deleteRouteCaches,
  deleteWatchCaches,
  enqueueMutation,
  getCache,
  installPlanningBundle,
  pendingMutations,
  pruneRouteCaches,
  pruneWatchCaches,
  putCache,
  wipeUserCache,
} from '../data/cache';
import { refreshPlanningBundleUntilFresh, syncPlanningBundle } from '../data/planningBundleSync';
import { routeToGpx } from '../data/gpx';
import {
  beginLocalRoutePromotion,
  cancelLocalRoutePromotion,
  clearRouteSyncIntent,
  clearRouteSyncIntentsForUser,
  completeLocalRoutePromotion,
  putRouteSyncIntent,
  reconcileSuccessfulLocalRoutePromotions,
  routeSyncIntents,
} from '../data/routeLibrary';
import { normalizedRouteName, reconcileRouteSummaries } from '../data/routeLibraryModel';
import type { PreferenceValues } from '../data/preferences';
import type { PendingPreferenceEdit } from '../data/mutationQueue';
import {
  createPreferenceEditWriter,
  createPreferenceSyncCoordinator,
} from '../data/preferenceSync';
import {
  cloudRouteFromDescriptor,
  projectCloudRoutes,
  type CachedCloudRoute,
} from '../data/cloudRoutes';
import {
  deactivateDeviceBeforeSignOut,
  parsePendingDeviceRevocation,
  pendingDeviceRevocation,
} from '../notifications/pendingRevocation';
import { acknowledgeOwnedNotification } from '../notifications/openOwnership';
import {
  initialNotificationReadiness,
  permissionState,
  readinessFromDeviceStatus,
  shouldUpsertCurrentNotificationToken,
  type NotificationReadiness,
} from '../notifications/readiness';
import {
  minimalNotificationSnapshot,
  type MinimalNotificationSnapshot,
} from '../notifications/responseModel';
import { parseStravaCallbackUrl, stravaCallbackError } from './stravaCallback';
import {
  createSerializedSessionWriter,
  parseStoredSession,
  removeLegacySession,
} from './storedSession';
import { createAccountScope, type AccountScope } from './accountScope';
import { createAccountTaskRunner } from './accountTask';

const SESSION_KEY = 'runcast.session.v2';
const LEGACY_SESSION_KEY = 'runcast.session.v1';
const DEVICE_KEY = 'runcast.device.v1';
const PENDING_DEVICE_REVOCATION_KEY = 'runcast.device-revocation.pending.v1';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const configuredScheme = Constants.expoConfig?.extra?.deepLinkScheme;
const STRAVA_CALLBACK_URI = `${typeof configuredScheme === 'string' ? configuredScheme : 'runcast'}://auth/strava`;
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function deleteSecureItem(key: string): Promise<void> {
  // expo-secure-store has no web implementation. Web is a read-only preview
  // surface today, so there is no persisted credential to remove there.
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(key, secureOptions);
}

export type AuthStatus = 'hydrating' | 'guest' | 'authenticated';
export type SyncStatus = 'idle' | 'syncing' | 'offline';
export type PreferenceSyncStatus = 'idle' | 'syncing' | 'offline' | 'conflict';
export type { PreferenceValues } from '../data/preferences';

interface AuthContextValue {
  status: AuthStatus;
  session: AuthTokens | null;
  appleAvailable: boolean;
  authProviders: AuthProviderName[];
  stravaConnected: boolean;
  notificationReadiness: NotificationReadiness;
  syncStatus: SyncStatus;
  preferenceSyncStatus: PreferenceSyncStatus;
  preferences: PreferenceValues | null;
  conflicts: number;
  cloudRoutes: CachedCloudRoute[];
  routeSummaries: RouteSummary[];
  latestWatchResults: WatchResultSummary[];
  signInWithStrava: (seed?: PreferenceValues) => Promise<{ isNewUser: boolean }>;
  completeStravaSignIn: (code: string, seed?: PreferenceValues) => Promise<{ isNewUser: boolean }>;
  signInWithApple: (seed?: PreferenceValues) => Promise<{ isNewUser: boolean }>;
  linkApple: () => Promise<void>;
  signOut: (allDevices?: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
  connectStrava: () => Promise<void>;
  listStravaRoutes: () => Promise<StravaRoute[]>;
  importStravaRoute: (routeId: string) => Promise<{ id: string; name: string }>;
  getWatches: () => Promise<Watch[]>;
  createWatch: (watch: Omit<CreateWatch, 'idempotencyKey'>) => Promise<'saved' | 'queued'>;
  updateWatch: (
    watch: Watch,
    changes: Partial<
      Pick<
        Watch,
        | 'weekdays'
        | 'timezone'
        | 'startMinutes'
        | 'endMinutes'
        | 'speed'
        | 'leadMinutes'
        | 'enabled'
      >
    >,
  ) => Promise<'saved' | 'queued'>;
  setWatchEnabled: (watch: Watch, enabled: boolean) => Promise<'saved' | 'queued'>;
  deleteWatch: (watch: Watch) => Promise<'saved' | 'queued'>;
  getWatchResults: (watchId: string) => Promise<WatchResultSummary[]>;
  getWatchResult: (watchId: string, evaluationId: string) => Promise<WatchResultDetail>;
  getNotificationResultFallback: (
    evaluationId: string,
  ) => Promise<MinimalNotificationSnapshot | null>;
  enableNotifications: () => Promise<void>;
  refreshNotificationReadiness: () => Promise<void>;
  consumeNotificationOpen: (payload: NotificationPayload) => Promise<'opened' | 'discarded'>;
  saveRoute: (
    route: Route,
    coverage: CoverageMask,
    originalGpx?: string,
  ) => Promise<'saved' | 'queued'>;
  renameCloudRoute: (route: RouteSummary, name: string) => Promise<'saved' | 'queued'>;
  deleteCloudRoute: (routeId: string) => Promise<'saved' | 'queued'>;
  getPreferences: () => Promise<PreferenceValues | null>;
  savePreferences: (preferences: PreferenceValues) => Promise<'saved' | 'queued' | 'conflict'>;
  refreshPlanningBundle: (routeId: string) => Promise<void>;
  syncNow: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function randomValue(bytes = 24): Promise<string> {
  const value = await Crypto.getRandomBytesAsync(bytes);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deviceIdentifier(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY, secureOptions);
  if (existing) return existing;
  const created = await randomValue(24);
  await SecureStore.setItemAsync(DEVICE_KEY, created, secureOptions);
  return created;
}

async function storeSession(session: AuthTokens | null): Promise<void> {
  if (session) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), secureOptions);
  else await deleteSecureItem(SESSION_KEY);
}

function easProjectId(): string | null {
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  return typeof projectId === 'string' && projectId ? projectId : null;
}

function osPermission(
  permission: Notifications.NotificationPermissionsStatus,
): NotificationReadiness['permission'] {
  return permissionState({
    platform: Platform.OS,
    granted: permission.granted,
    status: permission.status,
    iosStatus: permission.ios?.status,
    iosNotDetermined: Notifications.IosAuthorizationStatus.NOT_DETERMINED,
    iosDenied: Notifications.IosAuthorizationStatus.DENIED,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('hydrating');
  const [session, setSession] = useState<AuthTokens | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [authProviders, setAuthProviders] = useState<AuthProviderName[]>([]);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [notificationReadiness, setNotificationReadiness] = useState<NotificationReadiness>(
    initialNotificationReadiness,
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [preferenceSyncStatus, setPreferenceSyncStatus] = useState<PreferenceSyncStatus>('idle');
  const [preferencesState, setPreferencesState] = useState<PreferenceValues | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [cloudRoutes, setCloudRoutes] = useState<CachedCloudRoute[]>([]);
  const [latestWatchResults, setLatestWatchResults] = useState<WatchResultSummary[]>([]);
  const [routeSummaries, setRouteSummaries] = useState<RouteSummary[]>([]);
  const clientRef = useRef<ApiClient | null>(null);
  const sessionRef = useRef<AuthTokens | null>(null);
  const preferencesRef = useRef<Preferences | null>(null);
  const routeSummariesRef = useRef<RouteSummary[]>([]);
  const accountSync = useRef(createAccountTaskRunner());
  const routeIntentClock = useRef(0);
  const planningRefreshes = useRef(new Map<string, Promise<void>>());
  const deviceIdRef = useRef<string | null>(null);
  const sessionWriterRef = useRef(createSerializedSessionWriter(storeSession));

  const applyPreferences = useCallback((next: Preferences | null) => {
    preferencesRef.current = next;
    setPreferencesState(next);
  }, []);

  const applyRouteSummaries = useCallback((next: RouteSummary[]) => {
    routeSummariesRef.current = next;
    setRouteSummaries(next);
  }, []);

  const resetAccountState = useCallback(() => {
    planningRefreshes.current.clear();
    setAuthProviders([]);
    setStravaConnected(false);
    setCloudRoutes([]);
    setLatestWatchResults([]);
    applyRouteSummaries([]);
    applyPreferences(null);
    setPreferenceSyncStatus('idle');
    setSyncStatus('idle');
    setConflicts(0);
    setNotificationReadiness((current) => ({
      ...current,
      registration: 'unregistered',
      serverState: null,
      enabledWatchCount: 0,
    }));
  }, [applyPreferences, applyRouteSummaries]);

  const applySession = useCallback(
    async (next: AuthTokens | null) => {
      if (sessionRef.current?.user.id !== next?.user.id || !next) resetAccountState();
      sessionRef.current = next;
      setSession(next);
      setStatus(next ? 'authenticated' : 'guest');
      await sessionWriterRef.current(next);
    },
    [resetAccountState],
  );

  const client = useCallback(() => {
    if (!clientRef.current) throw new Error('Authentication is still loading');
    return clientRef.current;
  }, []);

  const accountScope = useCallback(
    (active: AuthTokens) => createAccountScope(active, client(), () => sessionRef.current),
    [client],
  );

  const requiredAccountScope = useCallback(() => {
    const active = sessionRef.current;
    if (!active) throw new Error('Sign in is required');
    return accountScope(active);
  }, [accountScope]);

  const clearPendingDeviceRevocation = useCallback(
    () => deleteSecureItem(PENDING_DEVICE_REVOCATION_KEY),
    [],
  );

  const persistPendingDeviceRevocation = useCallback(
    (pending: ReturnType<typeof pendingDeviceRevocation>) =>
      SecureStore.setItemAsync(
        PENDING_DEVICE_REVOCATION_KEY,
        JSON.stringify(pending),
        secureOptions,
      ),
    [],
  );

  const retryPendingDeviceRevocation = useCallback(
    async (currentSession: AuthTokens | null = sessionRef.current): Promise<void> => {
      const raw = await SecureStore.getItemAsync(PENDING_DEVICE_REVOCATION_KEY, secureOptions);
      const pending = parsePendingDeviceRevocation(raw);
      if (!pending) {
        if (raw) await clearPendingDeviceRevocation();
        return;
      }
      const installedSession = sessionRef.current;
      const currentCanRevoke =
        currentSession?.user.id === pending.session.user.id &&
        installedSession?.user.id === currentSession.user.id &&
        installedSession.refreshToken === currentSession.refreshToken;
      let retrySession = pending.session;
      let revocationClient;
      if (currentCanRevoke && currentSession) {
        revocationClient = client().bindSession(currentSession.user.id);
      } else {
        const dedicatedClient = new ApiClient(
          API_URL.replace(/\/$/, ''),
          pending.deviceId,
          async (next) => {
            if (next) {
              retrySession = next;
              await persistPendingDeviceRevocation({ ...pending, session: next });
            }
          },
        );
        dedicatedClient.setSession(pending.session);
        revocationClient = dedicatedClient;
      }
      try {
        await revocationClient.request('/v1/devices/current', { method: 'DELETE' });
        await revocationClient.request('/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify({
            refreshToken: currentCanRevoke
              ? pending.session.refreshToken
              : retrySession.refreshToken,
            allDevices: pending.allDevices,
          }),
        });
        await clearPendingDeviceRevocation();
      } catch {
        // Keep the encrypted, device-scoped record for the next foreground or session opportunity.
      }
    },
    [clearPendingDeviceRevocation, client, persistPendingDeviceRevocation],
  );

  const upsertNotificationDevice = useCallback(
    async (scope: AccountScope, token: Notifications.ExpoPushToken) => {
      if (Platform.OS !== 'ios' && Platform.OS !== 'android')
        throw new Error('Push notifications require the iOS or Android app.');
      const status = deviceStatusSchema.parse(
        await scope.api.request('/v1/devices/current', {
          method: 'PUT',
          body: JSON.stringify({
            expoPushToken: token.data,
            platform: Platform.OS,
            appVersion: Constants.expoConfig?.version ?? 'development',
            enabled: true,
          }),
        }),
      );
      scope.assertCurrent();
      return status;
    },
    [],
  );

  const refreshNotificationReadiness = useCallback(async (): Promise<void> => {
    const active = sessionRef.current;
    const scope = active ? accountScope(active) : null;
    const projectId = easProjectId();
    let permission: Notifications.NotificationPermissionsStatus;
    try {
      permission = await Notifications.getPermissionsAsync();
    } catch {
      if (scope ? !scope.isCurrent() : sessionRef.current !== null) return;
      setNotificationReadiness((current) => ({
        ...current,
        project: projectId ? 'configured' : 'missing',
        permission: 'checking',
        token: 'unavailable',
        registration: active ? 'offline' : 'unregistered',
      }));
      return;
    }
    const next: NotificationReadiness = {
      ...initialNotificationReadiness,
      permission: osPermission(permission),
      project: projectId ? 'configured' : 'missing',
      registration: active ? 'checking' : 'unregistered',
    };
    let currentToken: Notifications.ExpoPushToken | null = null;
    if (next.permission === 'granted' && projectId) {
      try {
        currentToken = await Notifications.getExpoPushTokenAsync({ projectId });
        next.token = 'available';
      } catch {
        next.token = 'unavailable';
      }
    }
    if (!active) {
      if (sessionRef.current) return;
      setNotificationReadiness(next);
      return;
    }
    if (!scope?.isCurrent()) return;
    try {
      const canRegister =
        currentToken &&
        shouldUpsertCurrentNotificationToken({
          authenticated: true,
          permission: next.permission,
          project: next.project,
          token: next.token,
        }) &&
        (Platform.OS === 'ios' || Platform.OS === 'android');
      const deviceStatus = canRegister
        ? await upsertNotificationDevice(scope, currentToken!)
        : deviceStatusSchema.parse(await scope.api.request('/v1/devices/current'));
      scope.assertCurrent();
      setNotificationReadiness(readinessFromDeviceStatus(next, deviceStatus));
    } catch {
      if (!scope.isCurrent()) return;
      setNotificationReadiness({ ...next, registration: 'offline' });
    }
  }, [accountScope, upsertNotificationDevice]);

  const refreshCloudProjection = useCallback(
    async (active: AuthTokens) => {
      const scope = accountScope(active);
      const [rows, cachedSummaries, intents] = await Promise.all([
        cachedCloudRoutes(scope.userId),
        getCache<RouteSummary[]>(scope.userId, 'account', 'routes'),
        routeSyncIntents(scope.userId),
      ]);
      const summaries = (cachedSummaries ?? rows.map((row) => row.summary)).flatMap((raw) => {
        const parsed = routeSummarySchema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      });
      scope.assertCurrent();
      applyRouteSummaries(reconcileRouteSummaries(summaries, intents));
      setCloudRoutes(projectCloudRoutes(rows, summaries, intents));
    },
    [accountScope, applyRouteSummaries],
  );

  const refreshIdentities = useCallback(async (scope: AccountScope) => {
    const [integration, identities] = await Promise.all([
      scope.api.request<{ connected: boolean }>('/v1/integrations/strava'),
      scope.api.request('/v1/me/identities').then(identityStatusSchema.parse),
    ]);
    scope.assertCurrent();
    setStravaConnected(integration.connected);
    setAuthProviders(identities.providers);
  }, []);

  const refreshWatchList = useCallback(async (scope: AccountScope) => {
    const result = watchListResponseSchema.parse(await scope.api.request('/v1/watches'));
    scope.assertCurrent();
    await putCache(scope.userId, 'account', 'watches', result.watches);
    await putCache(scope.userId, 'account', 'watch-latest-results', result.latestResults);
    await pruneWatchCaches(
      scope.userId,
      result.watches.map((watch) => watch.id),
    );
    scope.assertCurrent();
    setLatestWatchResults(result.latestResults);
    return result.watches;
  }, []);

  const preferenceSync = useRef(
    createPreferenceSyncCoordinator({
      read: readPendingPreferences,
      acknowledge: acknowledgePreferences,
      saveConfirmed: async (scope, result) => {
        await putCache(scope.userId, 'account', 'preferences', result.preferences);
        scope.assertCurrent();
        preferencesRef.current = result.preferences;
      },
      publish: (scope, result, complete) => {
        scope.assertCurrent();
        if (complete) {
          setPreferencesState(result.preferences);
          setPreferenceSyncStatus(result.status === 'conflict' ? 'conflict' : 'idle');
        }
      },
    }),
  );

  const refreshAccountData = useCallback(
    async (active: AuthTokens) => {
      await refreshCloudProjection(active);
      try {
        await refreshIdentities(accountScope(active));
      } catch {
        /* Cached account state remains available offline. */
      }
      await refreshNotificationReadiness();
    },
    [accountScope, refreshCloudProjection, refreshIdentities, refreshNotificationReadiness],
  );

  const syncNow = useCallback(() => {
    const active = sessionRef.current;
    if (!active) return Promise.resolve();
    const scope = accountScope(active);
    return accountSync.current.run(scope, async () => {
      setSyncStatus('syncing');
      let conflictCount = 0;
      try {
        await retryPendingDeviceRevocation(active);
        const pendingPreferences = await readPendingPreferences(active.user.id);
        scope.assertCurrent();
        if (pendingPreferences) {
          setPreferenceSyncStatus('syncing');
          if ((await preferenceSync.current.run(scope)) === 'conflict') conflictCount++;
        }

        const queuedMutations = await pendingMutations(active.user.id);
        for (const mutation of queuedMutations) {
          try {
            scope.assertCurrent();
            await scope.api.request(mutation.path, {
              method: mutation.method,
              body: mutation.body === undefined ? undefined : JSON.stringify(mutation.body),
            });
            // A queued local route upload stays replayable until its durable
            // promotion is complete. If the app stops between these operations,
            // the idempotent request is safe to run again on the next sync.
            await completeLocalRoutePromotion(active.user.id, mutation.id);
            await completeMutation(mutation.id);
            scope.assertCurrent();
          } catch (error) {
            if (
              error instanceof ApiClientError &&
              error.status === 409 &&
              error.code !== 'SESSION_CHANGED'
            ) {
              await conflictMutation(mutation.id, error.message);
              conflictCount++;
            }
            throw error;
          }
        }

        // Route intents live in the durable route database, independently of
        // the purgeable account cache. Recreate a missing replay after sign-out,
        // OS cache eviction, or an interrupted enqueue so a tombstone never
        // becomes a permanent local-only state.
        const durableRouteIntents = await routeSyncIntents(active.user.id);
        const queuedPaths = new Set(queuedMutations.map((mutation) => mutation.path));
        for (const intent of durableRouteIntents) {
          const path = `/v1/routes/${encodeURIComponent(intent.routeId)}`;
          if (queuedPaths.has(path)) continue;
          scope.assertCurrent();
          await scope.api.request(path, {
            method: intent.kind === 'delete' ? 'DELETE' : 'PATCH',
            body:
              intent.kind === 'rename'
                ? JSON.stringify({ name: intent.name, idempotencyKey: await randomValue() })
                : undefined,
          });
        }

        const routeList = routeListSchema.parse(await scope.api.request('/v1/routes'));
        scope.assertCurrent();
        await reconcileSuccessfulLocalRoutePromotions(active.user.id, routeList.routes);
        const intents = await routeSyncIntents(active.user.id);
        await putCache(active.user.id, 'account', 'routes', routeList.routes);
        await pruneRouteCaches(
          active.user.id,
          routeList.routes.map((route) => route.id),
        );
        for (const route of routeList.routes) {
          scope.assertCurrent();
          try {
            const descriptor = await scope.api.request(
              `/v2/routes/${encodeURIComponent(route.id)}`,
            );
            const prior = await cachedCloudRoute(active.user.id, route.id);
            scope.assertCurrent();
            await putCloudRoute(cloudRouteFromDescriptor(active.user.id, descriptor, prior));
            const result = await syncPlanningBundle({
              read: () => cachedPlanningBundle(active.user.id, route.id),
              request: (etag) =>
                scope.api.requestPlanningBundle(
                  route.id,
                  PLANNING_ALGORITHM_VERSION_MANIFEST_V3.build,
                  etag,
                ),
              promote: (body, etag) => {
                scope.assertCurrent();
                return installPlanningBundle({
                  userId: active.user.id,
                  routeId: route.id,
                  etag,
                  body,
                });
              },
            });
            const cached = await cachedCloudRoute(active.user.id, route.id);
            if (cached) await putCloudRoute({ ...cached, syncState: result.state });
          } catch (error) {
            scope.assertCurrent();
            const cached = await cachedCloudRoute(active.user.id, route.id);
            if (cached)
              await putCloudRoute({
                ...cached,
                summary: route,
                syncState:
                  error instanceof ApiClientError && error.status === 426
                    ? 'update-required'
                    : 'unavailable',
              });
          }
        }
        for (const intent of intents) {
          const remote = routeList.routes.find((route) => route.id === intent.routeId);
          if (
            (intent.kind === 'delete' && !remote) ||
            (intent.kind === 'rename' && remote?.name === intent.name)
          ) {
            await clearRouteSyncIntent(active.user.id, intent.routeId, intent.createdAt);
          }
        }
        await refreshCloudProjection(active);
        await refreshWatchList(scope);
        await refreshNotificationReadiness();
        await refreshIdentities(scope);
        setConflicts(conflictCount);
        setSyncStatus('idle');
      } catch {
        if (!scope.isCurrent()) return;
        setConflicts((count) => count + conflictCount);
        setSyncStatus('offline');
        setPreferenceSyncStatus((current) => (current === 'syncing' ? 'offline' : current));
      }
    });
  }, [
    accountScope,
    refreshCloudProjection,
    refreshWatchList,
    refreshIdentities,
    refreshNotificationReadiness,
    retryPendingDeviceRevocation,
  ]);

  const refreshPlanningBundle = useCallback(
    (routeId: string): Promise<void> => {
      const active = sessionRef.current;
      if (!active) return Promise.resolve();
      const scope = accountScope(active);
      const userId = active.user.id;
      const refreshKey = `${userId}:${routeId}`;
      const existing = planningRefreshes.current.get(refreshKey);
      if (existing) return existing;
      let task: Promise<void>;
      task = (async () => {
        const cached = await cachedPlanningBundle(userId, routeId);
        const fetchedAt = cached?.bundle.forecast.data.fetchedAt;
        if (fetchedAt !== undefined && forecastIsFresh(fetchedAt, Date.now())) return;
        const result = await refreshPlanningBundleUntilFresh({
          read: () => cachedPlanningBundle(userId, routeId),
          request: (etag) =>
            scope.api.requestPlanningBundle(
              routeId,
              PLANNING_ALGORITHM_VERSION_MANIFEST_V3.build,
              etag,
            ),
          promote: (body, etag) => {
            scope.assertCurrent();
            return installPlanningBundle({ userId, routeId, etag, body });
          },
        });
        if (!scope.isCurrent()) return;
        const route = await cachedCloudRoute(userId, routeId);
        if (route) await putCloudRoute({ ...route, syncState: result.state });
        await refreshCloudProjection(active);
      })().finally(() => {
        if (planningRefreshes.current.get(refreshKey) === task) {
          planningRefreshes.current.delete(refreshKey);
        }
      });
      planningRefreshes.current.set(refreshKey, task);
      return task;
    },
    [accountScope, refreshCloudProjection],
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [deviceId, available, raw, legacyRaw] = await Promise.all([
        deviceIdentifier(),
        Platform.OS === 'ios' ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false),
        SecureStore.getItemAsync(SESSION_KEY, secureOptions),
        SecureStore.getItemAsync(LEGACY_SESSION_KEY, secureOptions),
      ]);
      await removeLegacySession(
        legacyRaw,
        () => deleteSecureItem(LEGACY_SESSION_KEY),
        wipeUserCache,
      );
      if (!mounted) return;
      setAppleAvailable(available);
      const api = new ApiClient(API_URL.replace(/\/$/, ''), deviceId, applySession);
      clientRef.current = api;
      deviceIdRef.current = deviceId;
      const parsed = parseStoredSession(raw);
      if (!parsed) {
        await retryPendingDeviceRevocation(null);
        await applySession(null);
        await refreshNotificationReadiness();
        return;
      }
      api.setSession(parsed);
      sessionRef.current = parsed;
      setSession(parsed);
      setStatus('authenticated');
      await retryPendingDeviceRevocation(parsed);
      if (Date.parse(parsed.accessTokenExpiresAt) <= Date.now() + 60_000) {
        try {
          await api.refresh();
        } catch {
          return;
        }
      }
      const active = sessionRef.current;
      if (active) {
        await refreshAccountData(active);
        void syncNow();
      }
    })().catch(() => {
      if (!mounted) return;
      // Hydration can fail before secure storage is available (for example, an unsigned
      // simulator build without Keychain entitlements). Enter guest mode without attempting
      // another secure-store write from the recovery path.
      sessionRef.current = null;
      setSession(null);
      setStatus('guest');
      resetAccountState();
    });

    const revoke =
      Platform.OS === 'ios'
        ? AppleAuthentication.addRevokeListener(() => {
            const userId = sessionRef.current?.user.id;
            clientRef.current?.setSession(null);
            void applySession(null).then(() => (userId ? wipeUserCache(userId) : undefined));
          })
        : { remove: () => {} };
    if (Platform.OS !== 'web') {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    }
    return () => {
      mounted = false;
      revoke.remove();
    };
  }, [
    applySession,
    refreshAccountData,
    refreshNotificationReadiness,
    retryPendingDeviceRevocation,
    syncNow,
  ]);

  const appleCredentialBody = useCallback(async () => {
    if (!appleAvailable) throw new Error('Sign in with Apple is unavailable on this device');
    const rawNonce = await randomValue();
    const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const credential = await AppleAuthentication.signInAsync({
      nonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken || !credential.authorizationCode)
      throw new Error('Apple did not return credentials');
    const displayName = credential.fullName
      ? AppleAuthentication.formatFullName(credential.fullName).trim() || undefined
      : undefined;
    return {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      nonce: rawNonce,
      ...(displayName ? { displayName } : {}),
      ...(credential.email ? { email: credential.email } : {}),
    };
  }, [appleAvailable]);

  const finishAuthentication = useCallback(
    async (result: AuthTokens, seed?: Omit<Preferences, 'updatedAt' | 'version'>) => {
      client().setSession(result);
      await applySession(result);
      const scope = accountScope(result);
      if (result.isNewUser && seed) {
        const preferences = preferencesSchema.parse(
          await scope.api.request('/v1/me/preferences', {
            method: 'PUT',
            body: JSON.stringify({ ...seed, version: 1 }),
          }),
        );
        scope.assertCurrent();
        await putCache(result.user.id, 'account', 'preferences', preferences);
        applyPreferences(preferences);
      }
      await retryPendingDeviceRevocation(result);
      scope.assertCurrent();
      await refreshAccountData(result);
      void syncNow();
      return { isNewUser: result.isNewUser };
    },
    [
      applyPreferences,
      applySession,
      accountScope,
      client,
      refreshAccountData,
      retryPendingDeviceRevocation,
      syncNow,
    ],
  );

  const completeStravaSignIn = useCallback(
    async (code: string, seed?: Omit<Preferences, 'updatedAt' | 'version'>) => {
      const deviceId = await deviceIdentifier();
      const result = authTokensSchema.parse(
        await client().request('/v1/auth/strava/exchange', {
          method: 'POST',
          body: JSON.stringify({ code, deviceId }),
        }),
      );
      return finishAuthentication(result, seed);
    },
    [client, finishAuthentication],
  );

  const signInWithStrava = useCallback(
    async (seed?: Omit<Preferences, 'updatedAt' | 'version'>) => {
      const deviceId = await deviceIdentifier();
      const authorization = stravaAuthorizationResponseSchema.parse(
        await client().request('/v1/auth/strava/authorization', {
          method: 'POST',
          body: JSON.stringify({
            purpose: 'sign_in',
            deviceId,
            redirectUri: STRAVA_CALLBACK_URI,
          }),
        }),
      );
      const response = await WebBrowser.openAuthSessionAsync(
        authorization.authorizationUrl,
        STRAVA_CALLBACK_URI,
      );
      if (response.type !== 'success') throw new Error('Strava sign-in was canceled.');
      const callback = parseStravaCallbackUrl(response.url);
      if (callback.type === 'cancelled') throw new Error('Strava sign-in was canceled.');
      if (callback.type === 'error') throw stravaCallbackError(callback);
      if (callback.type !== 'code') throw new Error('Strava did not return a sign-in code.');
      return completeStravaSignIn(callback.code, seed);
    },
    [client, completeStravaSignIn],
  );

  const signInWithApple = useCallback(
    async (seed?: Omit<Preferences, 'updatedAt' | 'version'>) => {
      const deviceId = await deviceIdentifier();
      const credential = await appleCredentialBody();
      const result = authTokensSchema.parse(
        await client().request('/v1/auth/apple', {
          method: 'POST',
          body: JSON.stringify({
            ...credential,
            deviceId,
          }),
        }),
      );
      return finishAuthentication(result, seed);
    },
    [appleCredentialBody, client, finishAuthentication],
  );

  const linkApple = useCallback(async () => {
    const scope = requiredAccountScope();
    const credential = await appleCredentialBody();
    const identities = identityStatusSchema.parse(
      await scope.api.request('/v1/me/identities/apple', {
        method: 'POST',
        body: JSON.stringify(credential),
      }),
    );
    scope.assertCurrent();
    setAuthProviders(identities.providers);
  }, [appleCredentialBody, requiredAccountScope]);

  const clearLocalUser = useCallback(async () => {
    const userId = sessionRef.current?.user.id;
    client().setSession(null);
    await applySession(null);
    if (userId) await wipeUserCache(userId);
  }, [applySession, client]);

  const signOut = useCallback(
    async (allDevices = false) => {
      const active = sessionRef.current;
      const scope = active ? accountScope(active) : null;
      const deviceId = deviceIdRef.current ?? (await deviceIdentifier());
      const refreshToken = active?.refreshToken;
      try {
        if (active) {
          const revocation = await deactivateDeviceBeforeSignOut({
            session: active,
            deviceId,
            deactivate: () => scope!.api.request('/v1/devices/current', { method: 'DELETE' }),
            persist: persistPendingDeviceRevocation,
            clear: clearPendingDeviceRevocation,
            allDevices,
          });
          if (revocation === 'pending') return;
        }
        try {
          await (scope?.api ?? client()).request('/v1/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ refreshToken, allDevices }),
          });
        } catch (error) {
          if (active) {
            await persistPendingDeviceRevocation(
              pendingDeviceRevocation(active, deviceId, allDevices),
            );
          }
          throw error;
        }
      } finally {
        if (!active || scope?.isCurrent()) await clearLocalUser();
      }
    },
    [
      accountScope,
      clearLocalUser,
      clearPendingDeviceRevocation,
      client,
      persistPendingDeviceRevocation,
    ],
  );

  const deleteAccount = useCallback(async () => {
    const scope = requiredAccountScope();
    const userId = scope.userId;
    await scope.api.request('/v1/me', { method: 'DELETE' });
    if (!scope.isCurrent()) return;
    await clearPendingDeviceRevocation();
    await clearRouteSyncIntentsForUser(userId);
    await clearLocalUser();
  }, [clearLocalUser, clearPendingDeviceRevocation, requiredAccountScope]);

  const connectStrava = useCallback(async () => {
    const scope = requiredAccountScope();
    const deviceId = await deviceIdentifier();
    const authorization = stravaAuthorizationResponseSchema.parse(
      await scope.api.request('/v1/auth/strava/authorization', {
        method: 'POST',
        body: JSON.stringify({
          purpose: 'link',
          deviceId,
          redirectUri: STRAVA_CALLBACK_URI,
        }),
      }),
    );
    const response = await WebBrowser.openAuthSessionAsync(
      authorization.authorizationUrl,
      STRAVA_CALLBACK_URI,
    );
    if (response.type !== 'success') throw new Error('Strava connection was canceled.');
    const callback = parseStravaCallbackUrl(response.url);
    if (callback.type === 'cancelled') throw new Error('Strava connection was canceled.');
    if (callback.type === 'error') throw stravaCallbackError(callback);
    if (callback.type !== 'connected') throw new Error('Strava did not complete the connection.');
    scope.assertCurrent();
    await refreshAccountData(scope.session);
  }, [refreshAccountData, requiredAccountScope]);

  const listStravaRoutes = useCallback(async () => {
    const scope = requiredAccountScope();
    const result = await scope.api.request<{ routes: StravaRoute[] }>(
      '/v1/integrations/strava/routes',
    );
    scope.assertCurrent();
    return result.routes;
  }, [requiredAccountScope]);

  const importStravaRoute = useCallback(
    async (routeId: string) => {
      const scope = requiredAccountScope();
      const idempotencyKey = await randomValue();
      const imported = await scope.api.request<{ id: string; name: string }>(
        `/v1/routes/strava/${encodeURIComponent(routeId)}/import`,
        {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey }),
        },
      );
      scope.assertCurrent();
      await syncNow();
      return imported;
    },
    [requiredAccountScope, syncNow],
  );

  const getWatches = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return [];
    const scope = accountScope(active);
    const cached = (await getCache<Watch[]>(active.user.id, 'account', 'watches')) ?? [];
    const cachedResults =
      (await getCache<WatchResultSummary[]>(active.user.id, 'account', 'watch-latest-results')) ??
      [];
    try {
      return await refreshWatchList(scope);
    } catch {
      if (!scope.isCurrent()) return [];
      setLatestWatchResults(cachedResults);
      return cached;
    }
  }, [accountScope, refreshWatchList]);

  const queueableWatchMutation = useCallback(
    async (
      method: 'POST' | 'PATCH' | 'DELETE',
      path: string,
      body: Record<string, unknown> | undefined,
    ): Promise<'saved' | 'queued'> => {
      const active = sessionRef.current;
      if (!active) throw new Error('Sign in before changing a watch');
      const scope = accountScope(active);
      const idempotencyKey = await randomValue();
      const requestBody = body ? { ...body, idempotencyKey } : undefined;
      try {
        await scope.api.request(path, {
          method,
          body: requestBody ? JSON.stringify(requestBody) : undefined,
        });
        void syncNow();
        return 'saved';
      } catch (error) {
        scope.assertCurrent();
        if (error instanceof ApiClientError && error.status < 500) throw error;
        await enqueueMutation({
          id: idempotencyKey,
          userId: active.user.id,
          method,
          path,
          body: requestBody,
          idempotencyKey,
        });
        setSyncStatus('offline');
        return 'queued';
      }
    },
    [accountScope, syncNow],
  );

  const createWatch = useCallback(
    (watch: Omit<CreateWatch, 'idempotencyKey'>) =>
      queueableWatchMutation('POST', '/v1/watches', watch),
    [queueableWatchMutation],
  );

  const updateWatch = useCallback(
    (
      watch: Watch,
      changes: Partial<
        Pick<
          Watch,
          | 'weekdays'
          | 'timezone'
          | 'startMinutes'
          | 'endMinutes'
          | 'speed'
          | 'leadMinutes'
          | 'enabled'
        >
      >,
    ) =>
      queueableWatchMutation('PATCH', `/v1/watches/${watch.id}`, {
        ...changes,
        version: watch.version,
      }),
    [queueableWatchMutation],
  );

  const setWatchEnabled = useCallback(
    (watch: Watch, enabled: boolean) => updateWatch(watch, { enabled }),
    [updateWatch],
  );

  const deleteWatch = useCallback(
    async (watch: Watch) => {
      const active = sessionRef.current;
      const result = await queueableWatchMutation('DELETE', `/v1/watches/${watch.id}`, undefined);
      if (active) await deleteWatchCaches(active.user.id, watch.id);
      return result;
    },
    [queueableWatchMutation],
  );

  const getWatchResults = useCallback(
    async (watchId: string): Promise<WatchResultSummary[]> => {
      const active = sessionRef.current;
      if (!active) return [];
      const scope = accountScope(active);
      const cached =
        (await getCache<WatchResultSummary[]>(active.user.id, 'watch-history', watchId)) ?? [];
      try {
        const response = watchResultListResponseSchema.parse(
          await scope.api.request(`/v1/watches/${encodeURIComponent(watchId)}/results?limit=7`),
        );
        scope.assertCurrent();
        await putCache(active.user.id, 'watch-history', watchId, response.results);
        return response.results;
      } catch {
        if (!scope.isCurrent()) return [];
        return cached;
      }
    },
    [accountScope],
  );

  const getWatchResult = useCallback(
    async (watchId: string, evaluationId: string): Promise<WatchResultDetail> => {
      const active = sessionRef.current;
      if (!active) throw new Error('Sign in before opening this watch result.');
      const scope = accountScope(active);
      const key = `${watchId}:${evaluationId}`;
      const cached = await getCache<WatchResultDetail>(active.user.id, 'watch-result-detail', key);
      try {
        const result = watchResultDetailSchema.parse(
          await scope.api.request(
            `/v1/watches/${encodeURIComponent(watchId)}/results/${encodeURIComponent(evaluationId)}`,
          ),
        );
        scope.assertCurrent();
        await putCache(active.user.id, 'watch-result-detail', key, result);
        return result;
      } catch (error) {
        if (!scope.isCurrent()) throw error;
        const parsed = cached ? watchResultDetailSchema.safeParse(cached) : null;
        if (parsed?.success) return parsed.data;
        throw error;
      }
    },
    [accountScope],
  );

  const getNotificationResultFallback = useCallback(
    async (evaluationId: string): Promise<MinimalNotificationSnapshot | null> => {
      const active = sessionRef.current;
      if (!active) return null;
      return getCache<MinimalNotificationSnapshot>(
        active.user.id,
        'watch-result-fallback',
        evaluationId,
      );
    },
    [],
  );

  const registerNotifications = useCallback(
    async (prompt: boolean): Promise<void> => {
      const scope = requiredAccountScope();
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
        throw new Error('Push notifications require the iOS or Android app.');
      }
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('route-watches', {
          name: 'Route watch reminders',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      let permission = await Notifications.getPermissionsAsync();
      scope.assertCurrent();
      if (!permission.granted && prompt && osPermission(permission) === 'not-determined') {
        permission = await Notifications.requestPermissionsAsync();
        scope.assertCurrent();
      }
      const permissionValue = osPermission(permission);
      const projectId = easProjectId();
      setNotificationReadiness((current) => ({
        ...current,
        permission: permissionValue,
        project: projectId ? 'configured' : 'missing',
        token: permissionValue === 'granted' ? current.token : 'unknown',
      }));
      if (permissionValue !== 'granted') {
        throw new Error(
          permissionValue === 'denied'
            ? 'Notifications are blocked. Allow Runcast notifications in device Settings.'
            : 'Notification permission was not granted.',
        );
      }
      if (!projectId) throw new Error('This build is missing its EAS project ID.');
      let token: Notifications.ExpoPushToken;
      try {
        token = await Notifications.getExpoPushTokenAsync({ projectId });
        scope.assertCurrent();
      } catch {
        scope.assertCurrent();
        setNotificationReadiness((current) => ({ ...current, token: 'unavailable' }));
        throw new Error('Could not get a push token. Check your connection and try again.');
      }
      setNotificationReadiness((current) => ({ ...current, token: 'available' }));
      const deviceStatus = await upsertNotificationDevice(scope, token);
      scope.assertCurrent();
      setNotificationReadiness((current) => readinessFromDeviceStatus(current, deviceStatus));
    },
    [requiredAccountScope, upsertNotificationDevice],
  );

  const enableNotifications = useCallback(
    () => registerNotifications(true),
    [registerNotifications],
  );

  const consumeNotificationOpen = useCallback(
    async (payload: NotificationPayload): Promise<'opened' | 'discarded'> => {
      const active = sessionRef.current;
      if (!active) throw new Error('Sign in before opening this route notification.');
      const scope = accountScope(active);
      const path = `/v1/notifications/${encodeURIComponent(payload.delivery.id)}/opened`;
      try {
        return await acknowledgeOwnedNotification({
          acknowledge: () => scope.api.request(path, { method: 'POST' }),
          cache: async () => {
            if (!scope.isCurrent()) return;
            const snapshot = minimalNotificationSnapshot(payload);
            await putCache(active.user.id, 'notification-snapshot', payload.delivery.id, snapshot);
            if (payload.snapshot.engine === 'planning-v2') {
              await putCache(
                active.user.id,
                'watch-result-fallback',
                payload.snapshot.id,
                snapshot,
              );
            }
          },
          isNotFound: (error) => error instanceof ApiClientError && error.status === 404,
        });
      } catch (error) {
        scope.assertCurrent();
        if (error instanceof ApiClientError && error.status < 500) throw error;
        const mutationId = `notification-open-${payload.delivery.id}`;
        await enqueueMutation({
          id: mutationId,
          userId: active.user.id,
          method: 'POST',
          path,
          body: undefined,
          idempotencyKey: mutationId,
        });
        setSyncStatus('offline');
        throw error;
      }
    },
    [accountScope],
  );

  useEffect(() => {
    const tokenRotation =
      Platform.OS === 'web'
        ? { remove: () => {} }
        : Notifications.addPushTokenListener(() => {
            if (!sessionRef.current) return;
            void registerNotifications(false).catch(() => {
              void refreshNotificationReadiness();
            });
          });
    const foreground = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void retryPendingDeviceRevocation();
      void refreshNotificationReadiness();
    });
    return () => {
      tokenRotation.remove();
      foreground.remove();
    };
  }, [refreshNotificationReadiness, registerNotifications, retryPendingDeviceRevocation]);

  const saveRoute = useCallback(
    async (route: Route, coverage: CoverageMask, originalGpx?: string) => {
      const active = sessionRef.current;
      if (!active) throw new Error('Sign in before saving a route');
      const scope = accountScope(active);
      const idempotencyKey = await randomValue();
      const body = {
        gpx: originalGpx ?? routeToGpx(route),
        name: route.name,
        ...(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(route.id)
          ? { clientRouteId: route.id }
          : {}),
        coverage,
        idempotencyKey,
      };
      const promotesLocalRoute = await beginLocalRoutePromotion(
        active.user.id,
        route.id,
        idempotencyKey,
      );
      try {
        routeImportResultSchema.parse(
          await scope.api.request('/v1/routes/gpx', {
            method: 'POST',
            body: JSON.stringify(body),
          }),
        );
        if (promotesLocalRoute) {
          await completeLocalRoutePromotion(active.user.id, idempotencyKey);
        }
        void syncNow();
        return 'saved' as const;
      } catch (error) {
        scope.assertCurrent();
        if (error instanceof ApiClientError && error.status < 500) {
          if (promotesLocalRoute) {
            await cancelLocalRoutePromotion(active.user.id, idempotencyKey);
          }
          throw error;
        }
        await enqueueMutation({
          id: idempotencyKey,
          userId: active.user.id,
          method: 'POST',
          path: '/v1/routes/gpx',
          body,
          idempotencyKey,
        });
        setSyncStatus('offline');
        return 'queued' as const;
      }
    },
    [accountScope, syncNow],
  );

  const renameCloudRoute = useCallback(
    async (route: RouteSummary, requestedName: string): Promise<'saved' | 'queued'> => {
      const scope = requiredAccountScope();
      const name = normalizedRouteName(requestedName);
      const idempotencyKey = await randomValue();
      const createdAt = Math.max(Date.now(), routeIntentClock.current + 1);
      routeIntentClock.current = createdAt;
      await putRouteSyncIntent(scope.userId, {
        routeId: route.id,
        kind: 'rename',
        name,
        createdAt,
      });
      await refreshCloudProjection(scope.session);
      const body = { name, idempotencyKey };
      try {
        const saved = routeSummarySchema.parse(
          await scope.api.request(`/v1/routes/${encodeURIComponent(route.id)}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          }),
        );
        const remote = (await getCache<RouteSummary[]>(scope.userId, 'account', 'routes')) ?? [];
        await putCache(
          scope.userId,
          'account',
          'routes',
          remote.map((item) => (item.id === saved.id ? saved : item)),
        );
        await clearRouteSyncIntent(scope.userId, route.id, createdAt);
        await refreshCloudProjection(scope.session);
        return 'saved';
      } catch (error) {
        scope.assertCurrent();
        if (error instanceof ApiClientError && error.status < 500) {
          await clearRouteSyncIntent(scope.userId, route.id, createdAt);
          await refreshCloudProjection(scope.session);
          throw error;
        }
        await enqueueMutation({
          id: idempotencyKey,
          userId: scope.userId,
          method: 'PATCH',
          path: `/v1/routes/${encodeURIComponent(route.id)}`,
          body,
          idempotencyKey,
        });
        setSyncStatus('offline');
        return 'queued';
      }
    },
    [requiredAccountScope, refreshCloudProjection],
  );

  const deleteCloudRoute = useCallback(
    async (routeId: string): Promise<'saved' | 'queued'> => {
      const scope = requiredAccountScope();
      const idempotencyKey = await randomValue();
      const createdAt = Math.max(Date.now(), routeIntentClock.current + 1);
      routeIntentClock.current = createdAt;
      await putRouteSyncIntent(scope.userId, {
        routeId,
        kind: 'delete',
        name: null,
        createdAt,
      });
      await refreshCloudProjection(scope.session);
      try {
        await scope.api.request(`/v1/routes/${encodeURIComponent(routeId)}`, { method: 'DELETE' });
        const remote = (await getCache<RouteSummary[]>(scope.userId, 'account', 'routes')) ?? [];
        await putCache(
          scope.userId,
          'account',
          'routes',
          remote.filter((item) => item.id !== routeId),
        );
        await deleteRouteCaches(scope.userId, routeId);
        await clearRouteSyncIntent(scope.userId, routeId, createdAt);
        await refreshCloudProjection(scope.session);
        return 'saved';
      } catch (error) {
        scope.assertCurrent();
        if (error instanceof ApiClientError && error.status < 500) {
          await clearRouteSyncIntent(scope.userId, routeId, createdAt);
          await refreshCloudProjection(scope.session);
          throw error;
        }
        await enqueueMutation({
          id: idempotencyKey,
          userId: scope.userId,
          method: 'DELETE',
          path: `/v1/routes/${encodeURIComponent(routeId)}`,
          body: undefined,
          idempotencyKey,
        });
        setSyncStatus('offline');
        return 'queued';
      }
    },
    [requiredAccountScope, refreshCloudProjection],
  );

  const getPreferences = useCallback(async (): Promise<PreferenceValues | null> => {
    const active = sessionRef.current;
    if (!active) return null;
    const scope = accountScope(active);
    const cached = preferencesSchema.safeParse(
      await getCache<Preferences>(scope.userId, 'account', 'preferences'),
    );
    scope.assertCurrent();
    if (cached.success) preferencesRef.current = cached.data;
    const pending = await readPendingPreferences(scope.userId);
    scope.assertCurrent();
    const initial = pending?.values ?? (cached.success ? cached.data : null);
    setPreferencesState(initial);
    try {
      const remote = preferencesSchema.parse(await scope.api.request('/v1/me/preferences'));
      await putCache(scope.userId, 'account', 'preferences', remote);
      const latest = await readPendingPreferences(scope.userId);
      scope.assertCurrent();
      preferencesRef.current = remote;
      const visible = latest?.values ?? remote;
      setPreferencesState(visible);
      return visible;
    } catch {
      if (!scope.isCurrent()) return null;
      const visible = (await readPendingPreferences(scope.userId))?.values ?? initial;
      scope.assertCurrent();
      setPreferencesState(visible);
      return visible;
    }
  }, [accountScope]);

  const preferenceEdits = useRef(
    createPreferenceEditWriter(async (scope, values) => {
      const cached =
        preferencesRef.current ??
        (await getCache<Preferences>(scope.userId, 'account', 'preferences'));
      const editId = await randomValue();
      scope.assertCurrent();
      // A preceding local request may have advanced the confirmed version while
      // key generation was pending. Read the current confirmed ref again.
      const parsed = preferencesSchema.safeParse(preferencesRef.current ?? cached);
      const edit: PendingPreferenceEdit = {
        values,
        version: parsed.success ? parsed.data.version : null,
        editId,
      };
      await replacePendingPreferences(scope.userId, edit);
      return edit;
    }),
  );

  const savePreferences = useCallback(
    async (values: PreferenceValues): Promise<'saved' | 'queued' | 'conflict'> => {
      const scope = requiredAccountScope();
      const edit = await preferenceEdits.current(scope, values);
      scope.assertCurrent();
      setPreferencesState(values);
      setPreferenceSyncStatus('syncing');
      try {
        return await preferenceSync.current.run(scope);
      } catch (error) {
        scope.assertCurrent();
        if (error instanceof ApiClientError && error.status < 500) {
          await clearPendingPreferences(scope.userId, edit.editId);
          setPreferenceSyncStatus('idle');
          throw error;
        }
        setPreferenceSyncStatus('offline');
        return 'queued';
      }
    },
    [requiredAccountScope],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      appleAvailable,
      authProviders,
      stravaConnected,
      notificationReadiness,
      syncStatus,
      preferenceSyncStatus,
      preferences: preferencesState,
      conflicts,
      cloudRoutes,
      latestWatchResults,
      routeSummaries,
      signInWithStrava,
      completeStravaSignIn,
      signInWithApple,
      linkApple,
      signOut,
      deleteAccount,
      connectStrava,
      listStravaRoutes,
      importStravaRoute,
      getWatches,
      createWatch,
      updateWatch,
      setWatchEnabled,
      deleteWatch,
      getWatchResults,
      getWatchResult,
      getNotificationResultFallback,
      enableNotifications,
      refreshNotificationReadiness,
      consumeNotificationOpen,
      saveRoute,
      renameCloudRoute,
      deleteCloudRoute,
      getPreferences,
      savePreferences,
      refreshPlanningBundle,
      syncNow,
    }),
    [
      status,
      session,
      appleAvailable,
      authProviders,
      stravaConnected,
      notificationReadiness,
      syncStatus,
      preferenceSyncStatus,
      preferencesState,
      conflicts,
      cloudRoutes,
      latestWatchResults,
      routeSummaries,
      signInWithStrava,
      completeStravaSignIn,
      signInWithApple,
      linkApple,
      signOut,
      deleteAccount,
      connectStrava,
      listStravaRoutes,
      importStravaRoute,
      getWatches,
      createWatch,
      updateWatch,
      setWatchEnabled,
      deleteWatch,
      getWatchResults,
      getWatchResult,
      getNotificationResultFallback,
      enableNotifications,
      refreshNotificationReadiness,
      consumeNotificationOpen,
      saveRoute,
      renameCloudRoute,
      deleteCloudRoute,
      getPreferences,
      savePreferences,
      refreshPlanningBundle,
      syncNow,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
