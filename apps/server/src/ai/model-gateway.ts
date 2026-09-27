/**
 * The seam between the AI route and whatever calls a model. Only
 * ai-sdk-gateway.ts imports the Vercel AI SDK; the route and every test talk to
 * this interface, so an SDK upgrade touches one file and tests can script a
 * model without a network. See docs/decisions/007.
 */
import type { AiFinishReason, AiProvider, PromptMessage } from '@collabcode/shared';

/** Which model to call, and with whose key. */
export type ModelTarget = { provider: AiProvider; model: string; apiKey: string };

export type ModelCall = {
  target: ModelTarget;
  system: string;
  messages: PromptMessage[];
  maxOutputTokens: number;
  /** Aborted when the caller goes away or the call takes too long. */
  signal: AbortSignal;
};

export type ModelUsage = { inputTokens: number | null; outputTokens: number | null };

export type ModelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; finishReason: AiFinishReason; usage: ModelUsage };

export type ModelGateway = {
  /**
   * Streams the model's answer, ending with exactly one `finish` event.
   * Failures are thrown as ModelCallError, and nothing else is thrown.
   */
  stream: (call: ModelCall) => AsyncIterable<ModelEvent>;
};

export type ModelCallFailure =
  /** The provider refused the key. */
  | 'invalid-key'
  /** The provider's rate limit or quota for this key. */
  | 'rate-limited'
  /** The provider refused this request (bad model, too long, blocked). */
  | 'rejected'
  /** The provider could not be reached or failed on its side. */
  | 'unavailable'
  /** The call's signal was aborted. */
  | 'aborted';

/**
 * A failed model call, reduced to what is safe to log and act on. It never
 * carries the request, which holds the prompt and project code, nor the
 * provider's message text, which can echo part of a key.
 */
export class ModelCallError extends Error {
  readonly failure: ModelCallFailure;
  readonly statusCode: number | null;

  constructor(failure: ModelCallFailure, statusCode: number | null = null) {
    super(
      `model call failed: ${failure}${statusCode === null ? '' : ` (HTTP ${String(statusCode)})`}`,
    );
    this.name = 'ModelCallError';
    this.failure = failure;
    this.statusCode = statusCode;
  }
}
