export const INTRODUCTION_COMPLETION_KEY = 'runcast.introduction.completed';

const INTRODUCTION_COMPLETION_SENTINEL = 'completed';

export interface IntroductionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface IntroductionSnapshot {
  ready: boolean;
  completed: boolean;
}

type Listener = () => void;

/**
 * Small external store shared by the provider and its persistence tests.
 * Keeping completion in memory lets the app continue immediately even if the
 * best-effort AsyncStorage write fails.
 */
export class IntroductionState {
  private snapshot: IntroductionSnapshot = { ready: false, completed: false };
  private readonly listeners = new Set<Listener>();
  private hydration: Promise<void> | null = null;
  private completionRequested = false;

  constructor(private readonly storage: IntroductionStorage) {}

  readonly getSnapshot = (): IntroductionSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hydrate(): Promise<void> {
    if (!this.hydration) this.hydration = this.readCompletion();
    return this.hydration;
  }

  readonly complete = (): void => {
    if (this.snapshot.completed || this.completionRequested) return;

    this.completionRequested = true;
    this.update({ ...this.snapshot, completed: true });
    void this.storage
      .setItem(INTRODUCTION_COMPLETION_KEY, INTRODUCTION_COMPLETION_SENTINEL)
      .catch(() => {
        // Completion remains valid for this session. A later launch naturally
        // retries the introduction if the value was not persisted.
      });
  };

  private async readCompletion(): Promise<void> {
    let completed: boolean;
    try {
      completed =
        (await this.storage.getItem(INTRODUCTION_COMPLETION_KEY)) ===
        INTRODUCTION_COMPLETION_SENTINEL;
    } catch {
      // Storage availability must never block the Explorer.
      completed = true;
    }

    this.update({
      ready: true,
      completed: this.completionRequested ? true : completed,
    });
  }

  private update(next: IntroductionSnapshot): void {
    if (next.ready === this.snapshot.ready && next.completed === this.snapshot.completed) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
