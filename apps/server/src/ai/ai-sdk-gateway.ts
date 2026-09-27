/**
 * The ModelGateway backed by the Vercel AI SDK, and the only module that calls
 * it. Every call is made with the guardrails from docs/decisions/007:
 *
 * - a provider instance, never a model id string (language-models.ts);
 * - telemetry off, since otherwise the SDK publishes each call to a Node
 *   diagnostics channel that monitoring agents subscribe to;
 * - no retries, since each retry spends a request from the free daily quota;
 * - errors reduced to ModelCallError before anything can log them.
 */
import { streamText } from 'ai';
import type { Logger } from '../lib/logger.js';
import { createLanguageModel, type ModelInstance } from './language-models.js';
import {
  ModelCallError,
  type ModelEvent,
  type ModelGateway,
  type ModelTarget,
} from './model-gateway.js';
import { toModelCallError } from './provider-errors.js';

export type AiSdkGatewayDeps = {
  logger: Logger;
  /** Tests replace this with the SDK's mock model. */
  createModel?: (target: ModelTarget) => ModelInstance;
};

/**
 * The SDK prints provider warnings with console.warn unless told otherwise.
 * Send them through pino instead, as types only: some warnings quote settings,
 * and none of them are worth the risk of logging content.
 */
function routeSdkWarnings(logger: Logger): void {
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
    logger.warn({ provider, model, warnings: warnings.map((w) => w.type) }, 'ai sdk warnings');
  };
}

export function createAiSdkGateway({
  logger,
  createModel = createLanguageModel,
}: AiSdkGatewayDeps): ModelGateway {
  routeSdkWarnings(logger);

  return {
    async *stream(call): AsyncGenerator<ModelEvent> {
      try {
        const result = streamText({
          model: createModel(call.target),
          instructions: call.system,
          messages: call.messages,
          maxOutputTokens: call.maxOutputTokens,
          maxRetries: 0,
          abortSignal: call.signal,
          telemetry: { isEnabled: false },
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              if (part.text !== '') yield { type: 'text-delta', text: part.text };
              break;
            case 'finish':
              yield {
                type: 'finish',
                finishReason: part.finishReason,
                usage: {
                  inputTokens: part.totalUsage.inputTokens ?? null,
                  outputTokens: part.totalUsage.outputTokens ?? null,
                },
              };
              return;
            case 'error':
              throw part.error;
            case 'abort':
              throw new ModelCallError('aborted');
            default:
              break;
          }
        }
      } catch (error) {
        throw toModelCallError(error, call.signal);
      }
      // The stream ended without saying how.
      throw new ModelCallError('unavailable');
    },
  };
}
