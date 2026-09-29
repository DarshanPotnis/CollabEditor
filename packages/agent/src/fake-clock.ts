/**
 * A Clock whose time moves only when told to, for deterministic tests of
 * limits and waits, here and in the apps that run the agent.
 */
import type { Clock, StopSignal } from './types.js';

export type FakeClock = Clock & {
  /** Moves time forward and wakes every sleep that is due. */
  advance: (ms: number) => void;
  /** When the next sleep is due, or null when nothing sleeps. */
  nextWakeAt: () => number | null;
};

type Sleeper = { at: number; wake: () => void };

export function createFakeClock(start = 0): FakeClock {
  let now = start;
  const sleepers = new Set<Sleeper>();
  return {
    now: () => now,
    sleep(ms: number, signal: StopSignal) {
      return new Promise<void>((resolve) => {
        const sleeper: Sleeper = {
          at: now + ms,
          wake: () => {
            sleepers.delete(sleeper);
            signal.removeEventListener('abort', sleeper.wake);
            resolve();
          },
        };
        if (signal.aborted) {
          resolve();
          return;
        }
        sleepers.add(sleeper);
        signal.addEventListener('abort', sleeper.wake, { once: true });
      });
    },
    advance(ms) {
      now += ms;
      const due = [...sleepers].filter((sleeper) => sleeper.at <= now).sort((a, b) => a.at - b.at);
      for (const sleeper of due) sleeper.wake();
    },
    nextWakeAt() {
      let earliest: number | null = null;
      for (const sleeper of sleepers)
        earliest = earliest === null ? sleeper.at : Math.min(earliest, sleeper.at);
      return earliest;
    },
  };
}
