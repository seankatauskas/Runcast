import { preferencesSchema, type Preferences } from '@runcast/contracts';
import type { AccountScope } from '../auth/accountScope';
import { ApiClientError } from './api';
import type { PendingPreferenceEdit } from './mutationQueue';

type PreferenceResult = {
  status: 'saved' | 'conflict';
  preferences: Preferences;
  requestedVersion: number;
};
/** Immediate saves and background replay share the same version/conflict policy. */
export async function synchronizePreferences(
  scope: AccountScope,
  edit: PendingPreferenceEdit,
): Promise<PreferenceResult> {
  const version =
    edit.version ?? preferencesSchema.parse(await scope.api.request('/v1/me/preferences')).version;
  try {
    const preferences = preferencesSchema.parse(
      await scope.api.request('/v1/me/preferences', {
        method: 'PUT',
        body: JSON.stringify({ ...edit.values, version }),
      }),
    );
    scope.assertCurrent();
    return { status: 'saved', preferences, requestedVersion: version };
  } catch (error) {
    scope.assertCurrent();
    if (
      !(error instanceof ApiClientError) ||
      error.status !== 409 ||
      error.code === 'SESSION_CHANGED'
    )
      throw error;
    const parsed = preferencesSchema.safeParse(error.details);
    const preferences = parsed.success
      ? parsed.data
      : preferencesSchema.parse(await scope.api.request('/v1/me/preferences'));
    scope.assertCurrent();
    return { status: 'conflict', preferences, requestedVersion: version };
  }
}

interface PreferenceSyncStore {
  read(userId: string): Promise<PendingPreferenceEdit | null>;
  acknowledge(
    userId: string,
    editId: string,
    acceptedVersion: number | null,
    requestedVersion: number,
  ): Promise<boolean>;
  saveConfirmed(scope: AccountScope, result: PreferenceResult): Promise<void>;
  publish(scope: AccountScope, result: PreferenceResult, complete: boolean): void;
}

/** One writer per session; a concurrent local successor uses the accepted base version. */
export function createPreferenceSyncCoordinator(store: PreferenceSyncStore) {
  let running: { scope: AccountScope; task: Promise<'saved' | 'conflict'>; again: boolean } | null =
    null;
  return {
    run(scope: AccountScope): Promise<'saved' | 'conflict'> {
      if (running?.scope.userId === scope.userId && running.scope.isCurrent()) {
        running.again = true;
        return running.task;
      }
      const state = { scope, task: null as unknown as Promise<'saved' | 'conflict'>, again: false };
      state.task = (async () => {
        let status: 'saved' | 'conflict' = 'saved';
        do {
          state.again = false;
          scope.assertCurrent();
          const edit = await store.read(scope.userId);
          if (!edit) {
            if (state.again) continue;
            return status;
          }
          const result = await synchronizePreferences(scope, edit);
          await store.saveConfirmed(scope, result);
          const complete = await store.acknowledge(
            scope.userId,
            edit.editId,
            result.status === 'saved' ? result.preferences.version : null,
            result.requestedVersion,
          );
          await store.publish(scope, result, complete);
          status = result.status;
          // The acknowledgement preserves a newer edit and rebases it only
          // after this device successfully committed its predecessor.
          state.again = true;
        } while (state.again);
        return status;
      })().finally(() => {
        if (running === state) running = null;
      });
      running = state;
      return state.task;
    },
  };
}

/** Keep edit invocation order while key generation and cache reads are asynchronous. */
export function createPreferenceEditWriter(
  write: (
    scope: AccountScope,
    values: import('./preferences').PreferenceValues,
  ) => Promise<PendingPreferenceEdit>,
) {
  let tail: Promise<unknown> = Promise.resolve();
  return (
    scope: AccountScope,
    values: import('./preferences').PreferenceValues,
  ): Promise<PendingPreferenceEdit> => {
    const next = tail.then(() => {
      scope.assertCurrent();
      return write(scope, values);
    });
    tail = next.catch(() => undefined);
    return next;
  };
}
