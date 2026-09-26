import type { AccountScope } from './accountScope';

/** Coalesce refreshes, but repeat when a mutation lands after a refresh began. */
export function createAccountTaskRunner() {
  let pending: {
    scope: AccountScope;
    task: Promise<void>;
    started: boolean;
    again: boolean;
  } | null = null;
  return {
    run(scope: AccountScope, work: () => Promise<void>): Promise<void> {
      if (pending?.scope.userId === scope.userId && pending.scope.isCurrent()) {
        pending.again ||= pending.started;
        return pending.task;
      }
      const state = { scope, task: null as unknown as Promise<void>, started: false, again: false };
      state.task = Promise.resolve()
        .then(async () => {
          state.started = true;
          do {
            state.again = false;
            if (!scope.isCurrent()) return;
            await work();
          } while (state.again);
        })
        .finally(() => {
          if (pending === state) pending = null;
        });
      pending = state;
      return state.task;
    },
  };
}
