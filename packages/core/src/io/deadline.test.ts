import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestDeadlineExceededError, createRequestDeadline, fetchWithDeadline } from './deadline';

describe('request deadlines', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('composes caller cancellation without changing ownership', () => {
    const caller = new AbortController();
    const deadline = createRequestDeadline(caller.signal, 10_000);
    caller.abort('leaving-screen');
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe('leaving-screen');
    expect(deadline.didTimeout()).toBe(false);
    deadline.cleanup();
  });

  it('turns only deadline cancellation into a typed timeout error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          }),
      ),
    );
    const request = fetchWithDeadline('https://provider.example', {}, 20);
    const assertion = expect(request).rejects.toBeInstanceOf(RequestDeadlineExceededError);
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });
});
