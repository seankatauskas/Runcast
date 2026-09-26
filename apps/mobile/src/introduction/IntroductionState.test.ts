import { describe, expect, it, vi } from 'vitest';
import {
  INTRODUCTION_COMPLETION_KEY,
  IntroductionState,
  type IntroductionStorage,
} from './IntroductionState';

function storageWith(raw: string | null): IntroductionStorage {
  return {
    getItem: vi.fn(async () => raw),
    setItem: vi.fn(async () => {}),
  };
}

describe('introduction persistence', () => {
  it('treats missing storage as an incomplete first launch', async () => {
    const storage = storageWith(null);
    const state = new IntroductionState(storage);

    await state.hydrate();

    expect(storage.getItem).toHaveBeenCalledWith(INTRODUCTION_COMPLETION_KEY);
    expect(state.getSnapshot()).toEqual({ ready: true, completed: false });
  });

  it('hydrates the exact completed sentinel and leaves it unchanged for replay', async () => {
    const storage = storageWith('completed');
    const state = new IntroductionState(storage);

    await state.hydrate();

    expect(state.getSnapshot()).toEqual({ ready: true, completed: true });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(['', 'true', '1', '{"completed":true}', 'COMPLETED'])(
    'treats malformed value %j as incomplete',
    async (raw) => {
      const state = new IntroductionState(storageWith(raw));

      await state.hydrate();

      expect(state.getSnapshot()).toEqual({ ready: true, completed: false });
    },
  );

  it('fails open when storage cannot be read', async () => {
    const storage: IntroductionStorage = {
      getItem: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
      setItem: vi.fn(async () => {}),
    };
    const state = new IntroductionState(storage);

    await state.hydrate();

    expect(state.getSnapshot()).toEqual({ ready: true, completed: true });
  });

  it('completes in memory immediately and persists only once', async () => {
    const storage = storageWith(null);
    const state = new IntroductionState(storage);
    await state.hydrate();

    state.complete();
    state.complete();

    expect(state.getSnapshot()).toEqual({ ready: true, completed: true });
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(INTRODUCTION_COMPLETION_KEY, 'completed');
  });

  it('keeps the current session completed when persistence fails', async () => {
    const storage: IntroductionStorage = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {
        throw new Error('disk full');
      }),
    };
    const state = new IntroductionState(storage);
    await state.hydrate();

    state.complete();
    await Promise.resolve();

    expect(state.getSnapshot()).toEqual({ ready: true, completed: true });
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it('does not let a pending hydration overwrite an immediate completion', async () => {
    let finishRead: ((value: string | null) => void) | undefined;
    const storage: IntroductionStorage = {
      getItem: vi.fn(
        () =>
          new Promise<string | null>((resolve) => {
            finishRead = resolve;
          }),
      ),
      setItem: vi.fn(async () => {}),
    };
    const state = new IntroductionState(storage);
    const hydration = state.hydrate();

    state.complete();
    expect(state.getSnapshot()).toEqual({ ready: false, completed: true });

    finishRead?.(null);
    await hydration;
    expect(state.getSnapshot()).toEqual({ ready: true, completed: true });
  });
});
