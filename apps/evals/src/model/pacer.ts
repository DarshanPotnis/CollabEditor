/**
 * Keeps the eval key under its requests-a-minute limit: before each request,
 * waits until fewer than `rpm` have started in the last minute. Waiting here
 * is cheaper than being refused, since a refused request still counts.
 */
import type { Clock, StopSignal } from '@collabcode/agent';

const MINUTE_MS = 60_000;

export type Pacer = {
  /** Resolves when a request may start, or as soon as `signal` stops. */
  wait: (signal: StopSignal) => Promise<void>;
};

export function createPacer(rpm: number, clock: Clock): Pacer {
  const starts: number[] = [];
  return {
    async wait(signal) {
      for (;;) {
        if (signal.aborted) return;
        const now = clock.now();
        while (starts.length > 0 && (starts[0] ?? 0) <= now - MINUTE_MS) starts.shift();
        if (starts.length < rpm) {
          starts.push(now);
          return;
        }
        await clock.sleep((starts[0] ?? now) + MINUTE_MS - now, signal);
      }
    },
  };
}
