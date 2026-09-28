/**
 * A StopSignal the core can trigger itself, for its time limit. The core has no
 * AbortController: it is not part of the language, and the core may use only
 * the language (see tsconfig.build.json).
 */
import type { StopSignal } from './types.js';

export type StopSource = { signal: StopSignal; stop: () => void };

/** A listener added after the source has stopped is called at once. */
export function createStopSource(): StopSource {
  const listeners = new Set<() => void>();
  let aborted = false;
  const signal: StopSignal = {
    get aborted() {
      return aborted;
    },
    addEventListener(_type, listener) {
      if (aborted) listener();
      else listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
  return {
    signal,
    stop() {
      if (aborted) return;
      aborted = true;
      const toCall = [...listeners];
      listeners.clear();
      for (const listener of toCall) listener();
    },
  };
}

/** Stops as soon as any of `signals` does; `dispose` stops listening to them. */
export function stopOnAny(signals: readonly StopSignal[]): StopSource & { dispose: () => void } {
  const source = createStopSource();
  const stop = (): void => source.stop();
  for (const signal of signals) signal.addEventListener('abort', stop, { once: true });
  // A standard AbortSignal never calls a listener added after it stopped.
  if (signals.some((signal) => signal.aborted)) source.stop();
  return {
    ...source,
    dispose() {
      for (const signal of signals) signal.removeEventListener('abort', stop);
    },
  };
}
