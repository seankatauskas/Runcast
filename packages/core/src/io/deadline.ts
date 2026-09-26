export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
export const OVERPASS_TIMEOUT_MS = 25_000;
export const EXPO_PUSH_TIMEOUT_MS = 30_000;

export class RequestDeadlineExceededError extends Error {
  readonly code = 'REQUEST_TIMEOUT';

  constructor(public readonly timeoutMs: number) {
    super(`Request exceeded its ${timeoutMs} ms deadline`);
    this.name = 'RequestDeadlineExceededError';
  }
}

/**
 * Composes a caller-owned AbortSignal with a deadline without taking ownership
 * of that signal. Cleanup always removes the listener and timer.
 */
export function createRequestDeadline(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const deadline = createRequestDeadline(init.signal ?? undefined, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: deadline.signal });
  } catch (error) {
    if (deadline.didTimeout()) throw new RequestDeadlineExceededError(timeoutMs);
    throw error;
  } finally {
    deadline.cleanup();
  }
}
