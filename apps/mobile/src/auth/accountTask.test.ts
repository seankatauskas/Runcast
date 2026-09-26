import { describe, expect, it, vi } from 'vitest';
import type { AccountScope } from './accountScope';
import { createAccountTaskRunner } from './accountTask';

describe('account refresh coalescing', () => {
  it('shares overlapping refreshes and permits a subsequent refresh', async () => {
    const runner = createAccountTaskRunner();
    const scope = { userId: 'alice', isCurrent: () => true } as AccountScope;
    let finish!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = runner.run(scope, work);
    const second = runner.run(scope, work);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await runner.run(scope, async () => {});
  });
  it('does not join a stale session even when the account ID is unchanged', async () => {
    const runner = createAccountTaskRunner();
    let current = true;
    let finish!: () => void;
    const first = runner.run(
      { userId: 'alice', isCurrent: () => current } as AccountScope,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    current = false;
    const work = vi.fn(async () => {});
    await runner.run({ userId: 'alice', isCurrent: () => true } as AccountScope, work);
    expect(work).toHaveBeenCalledOnce();
    finish();
    await first;
  });
  it('repeats the refresh when an edit arrives after its data was fetched', async () => {
    const runner = createAccountTaskRunner();
    const scope = { userId: 'alice', isCurrent: () => true } as AccountScope;
    let finish!: () => void;
    const work = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const first = runner.run(scope, work);
    await Promise.resolve();
    const overlap = runner.run(scope, work);
    expect(overlap).toBe(first);
    finish();
    await first;
    expect(work).toHaveBeenCalledTimes(2);
  });
});
