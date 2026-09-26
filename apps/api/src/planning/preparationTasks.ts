/** Owns detached preparation work and bounds shutdown without unhandled rejections. */
export class PreparationTasks {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly cancellation = new AbortController();
  private readonly readers = new Set<Promise<void>>();
  private closing: Promise<boolean> | null = null;

  get closed(): boolean {
    return this.closing !== null;
  }

  get aborted(): boolean {
    return this.cancellation.signal.aborted;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  run(
    key: string,
    task: (signal: AbortSignal) => Promise<void>,
    onError: (error: unknown) => void,
  ): Promise<void> | null {
    if (this.closed) return null;
    const existing = this.pending.get(key);
    if (existing) return existing;
    // Defer execution until the promise is registered, including synchronous failures.
    const work = Promise.resolve()
      .then(() => task(this.cancellation.signal))
      .catch(onError)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  /** Include an awaited cache read in the shutdown boundary as well as its preparation. */
  readAfter<T>(work: Promise<void> | null, read: () => Promise<T>): Promise<T | null> {
    if (!work || this.closed) return Promise.resolve(null);
    const result = (async () => {
      await work;
      return this.aborted ? null : read();
    })();
    // Read errors belong to the awaiting caller; draining only waits for their settlement.
    const completion = result
      .then(
        () => {},
        () => {},
      )
      .finally(() => this.readers.delete(completion));
    this.readers.add(completion);
    return result;
  }

  /** Stop admission, then finish existing work or abandon its results at the deadline. */
  close(timeoutMs = 10_000): Promise<boolean> {
    if (this.closing) return this.closing;
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.closing = Promise.race([
      Promise.all([...this.pending.values(), ...this.readers]).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(
          () => {
            this.cancellation.abort();
            resolve(false);
          },
          Math.max(0, timeoutMs),
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }
}
