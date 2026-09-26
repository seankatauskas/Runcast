import { describe, expect, it, vi } from 'vitest';
import { PreparationTasks } from './preparationTasks';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('preparation task lifecycle', () => {
  it('coalesces work and waits for completion while refusing new work during shutdown', async () => {
    const tasks = new PreparationTasks();
    const gate = deferred();
    const prepare = vi.fn(() => gate.promise);
    const failed = vi.fn();
    const first = tasks.run('route', prepare, failed);
    expect(tasks.run('route', prepare, failed)).toBe(first);
    await Promise.resolve();
    const closing = tasks.close();
    expect(tasks.run('another-route', prepare, failed)).toBeNull();
    expect(tasks.has('route')).toBe(true);
    gate.resolve();
    await expect(closing).resolves.toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(tasks.has('route')).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  });

  it('waits for cache readback already owned by a preparation caller', async () => {
    const tasks = new PreparationTasks();
    const gate = deferred();
    const read = vi.fn(async () => {
      await gate.promise;
      return 'cached';
    });
    const result = tasks.readAfter(
      tasks.run('route', async () => {}, vi.fn()),
      read,
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    let closed = false;
    const closing = tasks.close().then((drained) => {
      closed = true;
      return drained;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    gate.resolve();
    await expect(result).resolves.toBe('cached');
    await expect(closing).resolves.toBe(true);
  });

  it('aborts on the shutdown deadline and still handles late failures', async () => {
    vi.useFakeTimers();
    try {
      const tasks = new PreparationTasks();
      const gate = deferred();
      const failed = vi.fn();
      let signal!: AbortSignal;
      const work = tasks.run(
        'route',
        async (taskSignal) => {
          signal = taskSignal;
          await gate.promise;
          throw new Error('late provider rejection');
        },
        failed,
      );
      const closing = tasks.close(100);
      await vi.advanceTimersByTimeAsync(100);
      await expect(closing).resolves.toBe(false);
      expect(signal.aborted).toBe(true);
      expect(tasks.run('route', async () => {}, failed)).toBeNull();
      gate.resolve();
      await work;
      expect(failed).toHaveBeenCalledOnce();
      expect(tasks.has('route')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
