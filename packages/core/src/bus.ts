/**
 * Tiny pub-sub for transient, 60fps interaction state — the hover position
 * shared between map and condition strip. Deliberately outside React:
 * publishing a hover at pointer-move frequency must not trigger a React
 * render cascade. Subscribers (a MapLibre marker, a canvas overlay) mutate
 * what they own directly. Committed state (start time, pace, route) lives
 * in normal React state in app/state.ts.
 */

export interface HoverState {
  /** Distance along the route, meters — or null when nothing is hovered. */
  distance: number | null;
  /** 'play' is the flyover animation; it yields to any human source. */
  source: 'map' | 'strip' | 'play' | 'splits';
}

type Listener<T> = (value: T) => void;

class Channel<T> {
  private listeners = new Set<Listener<T>>();
  private last: T;

  constructor(initial: T) {
    this.last = initial;
  }

  get value(): T {
    return this.last;
  }

  publish(value: T): void {
    this.last = value;
    for (const fn of this.listeners) fn(value);
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const hoverBus = new Channel<HoverState>({
  distance: null,
  source: 'map',
});
