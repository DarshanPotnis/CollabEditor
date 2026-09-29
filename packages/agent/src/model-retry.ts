/**
 * One model step, waiting out what is worth waiting out (docs/PLAN-AI.md §6.1):
 *
 * - a model that was busy before it answered (Google's 503 at times of high
 *   demand) is retried twice, after about 5 and then 15 seconds, with jitter so
 *   many sessions do not come back at the same moment;
 * - a per-minute limit is waited out for as long as it says, a few times.
 *
 * A failure after the model had started answering is never retried: that
 * answer was paid for. Every wait fits inside the session's time limit, or the
 * failure stands.
 */
import {
  BUSY_RETRY_DELAYS_MS,
  DEFAULT_RATE_LIMIT_WAIT_MS,
  MAX_RATE_LIMIT_WAITS,
} from './limits.js';
import {
  ModelStepError,
  type Clock,
  type ModelClient,
  type ModelStep,
  type ModelStepRequest,
} from './types.js';

/** A wait before trying again, and how long the attempt that failed had taken. */
export type RetryWait = { reason: 'busy' | 'rate-limited'; waitMs: number; attemptMs: number };

/** The answer, and how long the attempt that gave it took (waits and failed tries excluded). */
export type RetriedStep = { step: ModelStep; attemptMs: number };

export type RetryOptions = {
  client: ModelClient;
  request: ModelStepRequest;
  clock: Clock;
  /** A number in [0, 1), for jitter. */
  random: () => number;
  /** When the session's time is up, on the clock's scale. */
  deadline: number;
  onWait: (wait: RetryWait) => void;
};

function waitFor(
  error: ModelStepError,
  retries: { busy: number; rate: number },
  random: () => number,
): Omit<RetryWait, 'attemptMs'> | null {
  if (!error.upFront) return null;
  if (error.kind === 'busy') {
    const delay = BUSY_RETRY_DELAYS_MS[retries.busy];
    if (delay === undefined) return null;
    retries.busy += 1;
    return { reason: 'busy', waitMs: Math.round(delay * (0.8 + 0.4 * random())) };
  }
  if (error.kind === 'rate-limited' && retries.rate < MAX_RATE_LIMIT_WAITS) {
    retries.rate += 1;
    const base = error.retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
    return { reason: 'rate-limited', waitMs: base + Math.round(random() * 1_000) };
  }
  return null;
}

/** The model's step, or the ModelStepError that ended the tries. */
export async function stepWithRetries({
  client,
  request,
  clock,
  random,
  deadline,
  onWait,
}: RetryOptions): Promise<RetriedStep> {
  const retries = { busy: 0, rate: 0 };
  for (;;) {
    const started = clock.now();
    try {
      const step = await client.step(request);
      return { step, attemptMs: clock.now() - started };
    } catch (error) {
      if (!(error instanceof ModelStepError)) throw error;
      const wait = waitFor(error, retries, random);
      if (wait === null || clock.now() + wait.waitMs >= deadline) throw error;
      onWait({ ...wait, attemptMs: clock.now() - started });
      await clock.sleep(wait.waitMs, request.signal);
      if (request.signal.aborted)
        throw new ModelStepError('stopped', 'Stopped.', { upFront: true });
    }
  }
}
