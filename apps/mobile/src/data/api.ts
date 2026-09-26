import { apiErrorSchema, authTokensSchema, type AuthTokens } from '@runcast/contracts';
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  fetchWithDeadline,
  RequestDeadlineExceededError,
} from '@runcast/core';
import type { PlanningBundleHttpResult } from './planningBundleSync';

function withReference(message: string, requestId: string | undefined): string {
  return requestId ? `${message} Reference: ${requestId}` : message;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(withReference(message, requestId));
    this.name = 'ApiClientError';
  }
}

export class ApiTransportError extends Error {
  readonly status = 0;

  constructor(
    public readonly kind: 'timeout' | 'network',
    public readonly requestId: string,
  ) {
    super(
      withReference(
        kind === 'timeout'
          ? 'The request timed out. Check your connection and try again.'
          : 'Runcast could not reach the service. Check your connection and try again.',
        requestId,
      ),
    );
    this.name = 'ApiTransportError';
  }
}

type SessionChanged = (session: AuthTokens | null) => Promise<void>;

export interface SessionBoundApiClient {
  readonly userId: string;
  isCurrent(): boolean;
  request<T>(path: string, init?: RequestInit, retry?: boolean): Promise<T>;
  requestPlanningBundle(
    routeId: string,
    evaluatorBuild: string,
    etag?: string,
  ): Promise<PlanningBundleHttpResult>;
}

interface GenerationResult<T> {
  value: T;
  generation: number;
}

function canAutomaticallyReplay(init: RequestInit): boolean {
  const method = init.method?.toUpperCase() ?? 'GET';
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

export class ApiClient {
  private session: AuthTokens | null = null;
  private sessionGeneration = 0;
  private refreshPromise: { generation: number; promise: Promise<number> } | null = null;
  private requestSequence = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly deviceId: string,
    private readonly onSessionChanged: SessionChanged,
    private readonly timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  ) {}

  setSession(session: AuthTokens | null): void {
    this.session = session;
    this.sessionGeneration += 1;
  }

  bindSession(expectedUserId?: string): SessionBoundApiClient {
    let generation = this.sessionGeneration;
    const userId = this.session?.user.id;
    if (!userId || (expectedUserId !== undefined && userId !== expectedUserId)) {
      throw this.sessionChangedError();
    }
    return {
      userId,
      isCurrent: () => this.sessionGeneration === generation && this.session?.user.id === userId,
      request: async <T>(path: string, init: RequestInit = {}, retry = true) => {
        const result = await this.requestAtGeneration<T>(generation, path, init, retry);
        generation = result.generation;
        return result.value;
      },
      requestPlanningBundle: async (routeId: string, evaluatorBuild: string, etag?: string) => {
        const result = await this.requestPlanningBundleAtGeneration(
          generation,
          routeId,
          evaluatorBuild,
          etag,
        );
        generation = result.generation;
        return result.value;
      },
    };
  }

  private sessionChangedError(): ApiClientError {
    return new ApiClientError(
      409,
      'SESSION_CHANGED',
      'The signed-in account changed while this work was in progress.',
    );
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.sessionGeneration) throw this.sessionChangedError();
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `mobile-${Date.now().toString(36)}-${this.requestSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async response(
    path: string,
    init: RequestInit = {},
    retry = true,
    generation = this.sessionGeneration,
  ): Promise<GenerationResult<Response>> {
    this.assertGeneration(generation);
    const requestSession = this.session;
    const requestId = this.nextRequestId();
    let response: Response;
    try {
      response = await fetchWithDeadline(
        `${this.baseUrl}${path}`,
        {
          ...init,
          headers: {
            accept: 'application/json',
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(requestSession ? { authorization: `Bearer ${requestSession.accessToken}` } : {}),
            'x-request-id': requestId,
            ...init.headers,
          },
        },
        this.timeoutMs,
      );
    } catch (error) {
      throw new ApiTransportError(
        error instanceof RequestDeadlineExceededError ? 'timeout' : 'network',
        requestId,
      );
    }
    this.assertGeneration(generation);
    if (
      response.status === 401 &&
      retry &&
      requestSession?.refreshToken &&
      path !== '/v1/auth/refresh'
    ) {
      const nextGeneration = await this.refreshAtGeneration(generation);
      if (canAutomaticallyReplay(init)) return this.response(path, init, false, nextGeneration);
      throw new ApiClientError(
        401,
        'SESSION_REFRESHED',
        'Your session was refreshed. Try that action again.',
        undefined,
        requestId,
      );
    }
    return { value: response, generation };
  }

  private async responseError(response: Response, fallback: string): Promise<ApiClientError> {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    return new ApiClientError(
      response.status,
      parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.error.message : fallback,
      parsed.success ? parsed.data.error.details : undefined,
      parsed.success ? parsed.data.error.requestId : undefined,
    );
  }

  async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    return (await this.requestAtGeneration<T>(this.sessionGeneration, path, init, retry)).value;
  }

  private async requestAtGeneration<T>(
    generation: number,
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<GenerationResult<T>> {
    const result = await this.response(path, init, retry, generation);
    const response = result.value;
    if (!response.ok) {
      const error = await this.responseError(response, `API request failed (${response.status})`);
      this.assertGeneration(result.generation);
      throw error;
    }
    if (response.status === 204) return { value: undefined as T, generation: result.generation };
    const value = (await response.json()) as T;
    this.assertGeneration(result.generation);
    return { value, generation: result.generation };
  }

  async requestPlanningBundle(
    routeId: string,
    evaluatorBuild: string,
    etag?: string,
  ): Promise<PlanningBundleHttpResult> {
    return (
      await this.requestPlanningBundleAtGeneration(
        this.sessionGeneration,
        routeId,
        evaluatorBuild,
        etag,
      )
    ).value;
  }

  private async requestPlanningBundleAtGeneration(
    generation: number,
    routeId: string,
    evaluatorBuild: string,
    etag?: string,
  ): Promise<GenerationResult<PlanningBundleHttpResult>> {
    const result = await this.response(
      `/v2/routes/${encodeURIComponent(routeId)}/planning-bundle`,
      {
        headers: {
          'X-Runcast-Bundle-Reader': '3',
          'X-Runcast-Evaluator-Build': evaluatorBuild,
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      },
      true,
      generation,
    );
    const response = result.value;
    const responseEtag = response.headers.get('etag');
    if (response.status === 200) {
      if (!responseEtag) {
        throw new ApiClientError(502, 'BUNDLE_ETAG_MISSING', 'Planning bundle has no ETag');
      }
      const body = await response.text();
      this.assertGeneration(result.generation);
      return {
        value: { status: 'modified', body, etag: responseEtag },
        generation: result.generation,
      };
    }
    if (response.status === 304) {
      return {
        value: { status: 'not-modified', etag: responseEtag },
        generation: result.generation,
      };
    }
    if (response.status === 202) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        value: {
          status: 'preparing',
          retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5,
        },
        generation: result.generation,
      };
    }
    if (response.status === 404 || response.status === 426 || response.status === 503) {
      const error = await this.responseError(
        response,
        response.status === 404
          ? 'Planning bundles are not enabled for this route'
          : response.status === 426
            ? 'This app cannot read the current planning bundle'
            : 'No valid forecast artifact is available',
      );
      this.assertGeneration(result.generation);
      return {
        value:
          response.status === 426
            ? { status: 'update-required', reason: error.message }
            : { status: 'unavailable', reason: error.message },
        generation: result.generation,
      };
    }
    throw await this.responseError(response, `API request failed (${response.status})`);
  }

  async refresh(): Promise<void> {
    await this.refreshAtGeneration(this.sessionGeneration);
  }

  private async refreshAtGeneration(generation: number): Promise<number> {
    this.assertGeneration(generation);
    if (this.refreshPromise?.generation === generation) return this.refreshPromise.promise;
    const session = this.session;
    if (!session) throw new ApiClientError(401, 'AUTH_REQUIRED', 'Sign in is required');
    const refreshToken = session.refreshToken;
    const promise = (async () => {
      let response: Response;
      const requestId = this.nextRequestId();
      try {
        response = await fetchWithDeadline(
          `${this.baseUrl}/v1/auth/refresh`,
          {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'x-request-id': requestId,
            },
            body: JSON.stringify({ refreshToken, deviceId: this.deviceId }),
          },
          this.timeoutMs,
        );
      } catch (error) {
        throw new ApiTransportError(
          error instanceof RequestDeadlineExceededError ? 'timeout' : 'network',
          requestId,
        );
      }
      if (!response.ok) {
        const error = await this.responseError(
          response,
          `Session refresh failed (${response.status})`,
        );
        const confirmedInvalid =
          error.status === 401 &&
          (error.code === 'INVALID_REFRESH_TOKEN' || error.code === 'REFRESH_TOKEN_REUSED');
        if (confirmedInvalid) {
          this.assertGeneration(generation);
          this.session = null;
          this.sessionGeneration += 1;
          await this.onSessionChanged(null);
        }
        throw error;
      }
      const next = authTokensSchema.parse(await response.json());
      this.assertGeneration(generation);
      this.session = next;
      this.sessionGeneration += 1;
      const nextGeneration = this.sessionGeneration;
      await this.onSessionChanged(next);
      return nextGeneration;
    })();
    this.refreshPromise = { generation, promise };
    try {
      return await promise;
    } finally {
      if (this.refreshPromise?.promise === promise) this.refreshPromise = null;
    }
  }
}
