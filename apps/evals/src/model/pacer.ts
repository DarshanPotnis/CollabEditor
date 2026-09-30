/**
 * Keeps the eval key under its requests-a-minute limit: before each request,
 * waits until fewer than `rpm` have started in the last minute. Waiting here
 * is cheaper than being refused, since a refused request still counts.
 */
import type { Clock, StopSignal } from '@collabcode/agent';

const MINUTE_MS = 60_000;

/**
 * The share of the per-minute limit the pacer uses. Google counts a request
 * when it arrives, which is not exactly when the pacer let it start: pacing at
 * the limit itself, a run was once refused (429) and AI Studio showed 18 in a
 * minute against 15. 80% leaves room for that, as the server's shared tier does.
 */
export const PACING_SHARE = 0.8;

/** Requests a minute the pacer allows under a per-minute limit: 12 under 15. */
export function pacedRpm(limit: number): number {
  return Math.max(1, Math.floor(limit * PACING_SHARE));
}

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
