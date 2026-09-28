/**
 * The ModelGateway backed by the Vercel AI SDK, and the only module that calls
 * it. Every call is made with the guardrails from docs/decisions/007:
 *
 * - a provider instance, never a model id string (language-models.ts);
 * - telemetry off, since otherwise the SDK publishes each call to a Node
 *   diagnostics channel that monitoring agents subscribe to;
 * - no retries, since each retry spends a request from the free daily quota;
 * - errors reduced to ModelCallError before anything can log them, and an
 *   `onError` that prints nothing: the SDK's default prints each stream error
 *   with console.error, and an APICallError carries the whole prompt and the
 *   provider's message, which can echo the key.
 *
 * A call with tools also sends the conversation so far, declares the tools
 * without `execute` (so the model's calls come back to the browser), and ends
 * with the model's whole message for the browser to send back next step.
 */
import { streamText } from 'ai';
import type { Logger } from '../lib/logger.js';
import { fromSdkResponse, toSdkTools, toolUseMessages } from './ai-sdk-messages.js';
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
      let finish: Extract<ModelEvent, { type: 'finish' }> | null = null;
      try {
        const toolUse = call.toolUse;
        const result = streamText({
          model: createModel(call.target),
          instructions: call.system,
          messages: toolUse ? toolUseMessages(call.messages, toolUse) : call.messages,
          ...(toolUse && { tools: toSdkTools(toolUse.use), toolChoice: toolUse.use.toolChoice }),
          maxOutputTokens: call.maxOutputTokens,
          maxRetries: 0,
          abortSignal: call.signal,
          telemetry: { isEnabled: false },
          // The same error arrives as an 'error' part below and is reduced there.
          onError: () => undefined,
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              if (part.text !== '') yield { type: 'text-delta', text: part.text };
              break;
            case 'finish':
              finish = {
                type: 'finish',
                finishReason: part.finishReason,
                rawFinishReason: part.rawFinishReason?.slice(0, 64) ?? null,
                usage: {
                  inputTokens: part.totalUsage.inputTokens ?? null,
                  outputTokens: part.totalUsage.outputTokens ?? null,
                },
              };
              break;
            case 'error':
              throw part.error;
            case 'abort':
              throw new ModelCallError('aborted');
            default:
              break;
          }
        }

        if (finish && toolUse) {
          // Read once the stream has ended, which is when the SDK settles it.
          const message = fromSdkResponse((await result.response).messages);
          if (!message) throw new ModelCallError('oversized');
          finish.message = message;
        }
      } catch (error) {
        throw toModelCallError(error, call.signal);
      }
      if (finish) {
        yield finish;
        return;
      }
      // The stream ended without saying how.
      throw new ModelCallError('unavailable');
    },
  };
}
