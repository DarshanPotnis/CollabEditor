/**
 * Relays one model call to the HTTP response as a stream (docs/PLAN-AI.md §6.1).
 *
 * - The status is committed on the model's first event, so a call that fails
 *   before saying anything (a refused key, a busy provider) is an ordinary HTTP
 *   error. A failure after that ends the stream with an `error` event.
 * - When the caller goes away the model call is aborted, so a closed tab stops
 *   spending quota. The response's 'close' is the signal to watch; the
 *   request's fires as soon as its body has been read.
 * - The whole call is bounded by a timeout.
 * - Given more than one model, the next is tried only when the one before was
 *   busy (HTTP 503) before saying anything: the shared tier's fallback model.
 */
import type { AiFinishReason, AiStreamEvent } from '@collabcode/shared';
import type { Response } from 'express';
import type { FailureMessage, StepFailure } from '../ai/failure-messages.js';
import {
  ModelCallError,
  type ModelCall,
  type ModelGateway,
  type ModelTarget,
  type ModelUsage,
} from '../ai/model-gateway.js';
import { SSE_HEADERS, encodeSseEvent } from '../ai/sse.js';
import { sendApiError } from './errors.js';

/** What the finish event says besides the model it came from and what that model said. */
export type FinishDetails = Omit<
  Extract<AiStreamEvent, { type: 'finish' }>,
  'type' | 'finishReason' | 'usage' | 'message' | 'model'
>;

/** Models to try, in order. */
export type ModelTargets = readonly [ModelTarget, ...ModelTarget[]];

/** Timing, and how many models were tried: more than one means the fallback answered. */
type Timing = { firstEventMs: number | null; totalMs: number; attempts: number };

export type StreamOutcome =
  | ({
      status: 'finished';
      finishReason: AiFinishReason;
      rawFinishReason: string | null;
      usage: ModelUsage;
    } & Timing)
  | ({
      status: 'failed';
      failure: StepFailure;
      providerStatus: number | null;
      /** Set when the gateway broke its contract; the error's name, never its content. */
      unexpected: string | null;
    } & Timing)
  | ({ status: 'aborted' } & Timing);

export type StreamAnswerOptions = {
  res: Response;
  gateway: ModelGateway;
  call: Omit<ModelCall, 'signal' | 'target'>;
  targets: ModelTargets;
  finish: FinishDetails;
  timeoutMs: number;
  describe: (failure: StepFailure, providerStatus: number | null) => FailureMessage;
};

function sendFailure(res: Response, { code, message }: FailureMessage): void {
  if (res.headersSent) {
    res.end(encodeSseEvent({ type: 'error', error: { code, message } }));
  } else {
    sendApiError(res, code, message);
  }
}

/** A model busy before it said anything, which is when trying another is free. */
function busyUpFront(error: unknown, firstEventMs: number | null): boolean {
  return (
    firstEventMs === null &&
    error instanceof ModelCallError &&
    error.failure === 'unavailable' &&
    error.statusCode === 503
  );
}

export async function streamAnswer({
  res,
  gateway,
  call,
  targets,
  finish,
  timeoutMs,
  describe,
}: StreamAnswerOptions): Promise<StreamOutcome> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  let firstEventMs: number | null = null;
  let attempts = 0;

  const callerGone = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) callerGone.abort();
  };
  res.on('close', onClose);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([callerGone.signal, timeout]);

  const failed = (
    failure: StepFailure,
    providerStatus: number | null,
    unexpected: string | null,
  ): StreamOutcome => {
    sendFailure(res, describe(failure, providerStatus));
    return {
      status: 'failed',
      failure,
      providerStatus,
      unexpected,
      firstEventMs,
      totalMs: elapsed(),
      attempts,
    };
  };

  const attempt = async ([target, ...rest]: ModelTargets): Promise<StreamOutcome> => {
    attempts += 1;
    try {
      for await (const event of gateway.stream({ ...call, target, signal })) {
        if (firstEventMs === null) {
          firstEventMs = elapsed();
          res.writeHead(200, SSE_HEADERS);
        }
        if (event.type === 'text-delta') {
          res.write(encodeSseEvent({ type: 'text-delta', text: event.text }));
          continue;
        }
        res.end(
          encodeSseEvent({
            type: 'finish',
            finishReason: event.finishReason,
            rawFinishReason: event.rawFinishReason,
            usage: event.usage,
            model: { provider: target.provider, id: target.model },
            ...finish,
            ...(event.message && { message: event.message }),
          }),
        );
        return {
          status: 'finished',
          finishReason: event.finishReason,
          rawFinishReason: event.rawFinishReason,
          usage: event.usage,
          firstEventMs,
          totalMs: elapsed(),
          attempts,
        };
      }
      return failed('unavailable', null, 'stream ended without finishing');
    } catch (error) {
      if (callerGone.signal.aborted) {
        if (!res.writableEnded) res.end();
        return { status: 'aborted', firstEventMs, totalMs: elapsed(), attempts };
      }
      // A model that never started answering is most likely overloaded, not slow.
      if (timeout.aborted)
        return failed(firstEventMs === null ? 'no-answer' : 'timeout', null, null);
      const [next, ...others] = rest;
      if (next && busyUpFront(error, firstEventMs)) return attempt([next, ...others]);
      if (error instanceof ModelCallError && error.failure !== 'aborted') {
        return failed(error.failure, error.statusCode, null);
      }
      return failed('unavailable', null, error instanceof Error ? error.name : typeof error);
    }
  };

  try {
    return await attempt(targets);
  } finally {
    res.off('close', onClose);
  }
}
