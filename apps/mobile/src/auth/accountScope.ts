import type { AuthTokens } from '@runcast/contracts';
import { ApiClient, ApiClientError, type SessionBoundApiClient } from '../data/api';

export interface AccountScope {
  readonly session: AuthTokens;
  readonly userId: string;
  readonly api: SessionBoundApiClient;
  isCurrent(): boolean;
  assertCurrent(): void;
}

export function createAccountScope(
  session: AuthTokens,
  apiClient: ApiClient,
  currentSession: () => AuthTokens | null,
): AccountScope {
  const api = apiClient.bindSession(session.user.id);
  const isCurrent = () => api.isCurrent() && currentSession()?.user.id === session.user.id;
  return {
    session,
    userId: session.user.id,
    api,
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) {
        throw new ApiClientError(
          409,
          'SESSION_CHANGED',
          'The signed-in account changed while this work was in progress.',
        );
      }
    },
  };
}
