/**
 * When the bridge syncs. One shared, trailing wait over the whole project:
 * a sync starts once changes have been quiet for `quietMs`, but never later
 * than `maxWaitMs` after the first unsynced change, so continuous typing still
 * reaches the running server. Syncs never overlap; a change that arrives
 * during one is picked up by a single follow-up run.
 */
export type SyncScheduler = {
  /** Something changed; sync soon. */
  request: () => void;
  /** Sync now, and resolve once everything requested so far is applied. */
  flush: () => Promise<void>;
  dispose: () => void;
};

export type SyncSchedulerOptions = {
  quietMs: number;
  maxWaitMs: number;
  /** A sync that throws is reported here rather than left unhandled. */
  onError: (error: unknown) => void;
};

export function createSyncScheduler(
  run: () => Promise<void>,
  options: SyncSchedulerOptions,
): SyncScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstRequestAt: number | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    firstRequestAt = null;
  };

  const loop = async (): Promise<void> => {
    do {
      again = false;
      try {
        await run();
      } catch (error) {
        options.onError(error);
      }
    } while (again && !disposed);
    running = null;
  };

  const start = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };

  return {
    request() {
      if (disposed) return;
      const now = Date.now();
      firstRequestAt ??= now;
      if (timer !== null) clearTimeout(timer);
      const delay = Math.max(
        0,
        Math.min(options.quietMs, firstRequestAt + options.maxWaitMs - now),
      );
      timer = setTimeout(() => {
        clearTimer();
        void start();
      }, delay);
    },
    flush() {
      clearTimer();
      return disposed ? Promise.resolve() : start();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
