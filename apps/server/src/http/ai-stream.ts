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
 */
import type { AiFinishReason, AiStreamEvent } from '@collabcode/shared';
import type { Response } from 'express';
import type { FailureMessage, StepFailure } from '../ai/failure-messages.js';
import {
  ModelCallError,
  type ModelCall,
  type ModelGateway,
  type ModelUsage,
} from '../ai/model-gateway.js';
import { SSE_HEADERS, encodeSseEvent } from '../ai/sse.js';
import { sendApiError } from './errors.js';

/** What the finish event says besides what the model's own finish carries. */
export type FinishDetails = Omit<
  Extract<AiStreamEvent, { type: 'finish' }>,
  'type' | 'finishReason' | 'usage' | 'message'
>;

type Timing = { firstEventMs: number | null; totalMs: number };

export type StreamOutcome =
  | ({ status: 'finished'; finishReason: AiFinishReason; usage: ModelUsage } & Timing)
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
  call: Omit<ModelCall, 'signal'>;
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

export async function streamAnswer({
  res,
  gateway,
  call,
  finish,
  timeoutMs,
  describe,
}: StreamAnswerOptions): Promise<StreamOutcome> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  let firstEventMs: number | null = null;

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
    };
  };

  try {
    for await (const event of gateway.stream({ ...call, signal })) {
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
          usage: event.usage,
          ...finish,
          ...(event.message && { message: event.message }),
        }),
      );
      return {
        status: 'finished',
        finishReason: event.finishReason,
        usage: event.usage,
        firstEventMs,
        totalMs: elapsed(),
      };
    }
    return failed('unavailable', null, 'stream ended without finishing');
  } catch (error) {
    if (callerGone.signal.aborted) {
      if (!res.writableEnded) res.end();
      return { status: 'aborted', firstEventMs, totalMs: elapsed() };
    }
    if (timeout.aborted) return failed('timeout', null, null);
    if (error instanceof ModelCallError && error.failure !== 'aborted') {
      return failed(error.failure, error.statusCode, null);
    }
    return failed('unavailable', null, error instanceof Error ? error.name : typeof error);
  } finally {
    res.off('close', onClose);
  }
}
