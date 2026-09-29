/**
 * How many shared-tier requests everyone together may start in any 60
 * seconds, kept under the provider's own per-minute limit (RPM) so a burst is
 * slowed down here instead of refused by Google.
 *
 * - A rolling window, not a fixed one: a fixed window would let a full
 *   allowance through at 0:59 and another at 1:01, twice the limit within a
 *   second or two of Google's rolling minute.
 * - Checking and recording are separate, so the route can check this before
 *   the daily allowances and record a request only once those accept it.
 *   A visitor refused by the daily allowances never uses up anyone's minute.
 * - Counted in memory, like the daily allowances, and holding at most `limit`
 *   timestamps.
 */

export const MINUTE_MS = 60_000;

export type MinuteLimit = {
  /** How long until one more request fits: 0 when it fits now. */
  waitMs: () => number;
  /** Counts a request that is going ahead. */
  record: () => void;
};

export function createMinuteLimit(limit: number, now: () => number = Date.now): MinuteLimit {
  /** Start times of recent requests, oldest first. */
  const started: number[] = [];

  function forgetExpired(at: number): void {
    const firstLive = started.findIndex((start) => start > at - MINUTE_MS);
    started.splice(0, firstLive === -1 ? started.length : firstLive);
  }

  return {
    waitMs() {
      const at = now();
      forgetExpired(at);
      if (started.length < limit) return 0;
      // Full: the next slot opens when the request `limit` places back expires.
      const opening = started[started.length - limit];
      return opening === undefined ? MINUTE_MS : opening + MINUTE_MS - at;
    },
    record() {
      const at = now();
      forgetExpired(at);
      started.push(at);
      // Only the latest `limit` starts can ever decide a wait.
      if (started.length > limit) started.splice(0, started.length - limit);
    },
  };
}
