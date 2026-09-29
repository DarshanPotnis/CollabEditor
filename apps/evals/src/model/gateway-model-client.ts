/**
 * The agent's ModelClient for the evals: the server's own model gateway,
 * called in-process with the eval key, so a model is sent exactly what the
 * deployed app sends for the same prompt version, reminders and step count
 * included (stepsLeftFor, as the server counts them). The conversation is
 * validated the way the server validates it.
 *
 * What the server adds for visitors (daily admission, the minute share, the
 * fallback model) has no place here: the pacer keeps to the eval project's
 * per-minute limit and the ledger to its daily one, and a run measures one
 * model. Failures become ModelStepErrors the core acts on as it does in the
 * browser: a busy model or a rate limit before any answer is waited out;
 * anything else ends the session.
 */
import { ModelStepError, type ModelClient, type ModelStep } from '@collabcode/agent';
import { ModelCallError, type ModelGateway } from '@collabcode/model-gateway';
import {
  PROMPTS,
  conversationSchema,
  stepsLeftFor,
  type AgentTier,
  type AiProvider,
} from '@collabcode/shared';
import type { Secret } from '../secrets/eval-key.js';
import type { Pacer } from './pacer.js';
import { DailyLimitReached, type RequestLedger } from './request-ledger.js';

/** As the server's per-call limit. */
export const CALL_TIMEOUT_MS = 90_000;

export type GatewayModelClientOptions = {
  gateway: ModelGateway;
  provider: AiProvider;
  model: string;
  key: Secret;
  tier: AgentTier;
  pacer: Pacer;
  ledger: RequestLedger;
  /** Requests a day the eval project allows this model. */
  dailyLimit: number;
  callTimeoutMs?: number;
};

const agent = PROMPTS.agent;

function failed(message: string, upFront: boolean): ModelStepError {
  return new ModelStepError('failed', message, { upFront });
}

export function createGatewayModelClient(options: GatewayModelClientOptions): ModelClient {
  const { gateway, provider, model, key, tier, pacer, ledger, dailyLimit } = options;
  const timeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  const toolUse = agent.toolUse;
  if (!toolUse) throw new Error('The agent prompt declares its tools.');

  return {
    async step({ inputs, conversation, signal: stop, onText }): Promise<ModelStep> {
      const prepared = agent.prepare(inputs);
      if (!prepared.ok) throw failed(`The task's inputs were refused: ${prepared.message}`, true);
      const checked = conversationSchema.safeParse(conversation);
      if (!checked.success) {
        throw failed(
          `The conversation was refused: ${checked.error.issues[0]?.message ?? ''}`,
          true,
        );
      }
      try {
        ledger.ensureRoom(model, dailyLimit);
      } catch (error) {
        // The session ends as a model failure, with the ledger's own words.
        if (error instanceof DailyLimitReached) throw failed(error.message, true);
        throw error;
      }
      await pacer.wait(stop);
      if (stop.aborted) throw new ModelStepError('stopped', 'Stopped.', { upFront: true });

      const controller = new AbortController();
      const abort = (): void => controller.abort();
      stop.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let answered = false;
      await ledger.record(model);
      try {
        for await (const event of gateway.stream({
          target: { provider, model, apiKey: key.reveal() },
          system: prepared.prompt.system,
          messages: prepared.prompt.messages,
          maxOutputTokens: agent.maxOutputTokens,
          toolUse: {
            use: toolUse,
            conversation: checked.data,
            stepsLeft: stepsLeftFor(tier, checked.data),
          },
          signal: controller.signal,
        })) {
          answered = true;
          if (event.type === 'text-delta') {
            onText(event.text);
            continue;
          }
          if (!event.message)
            throw failed('The model answered in a form that could not be read.', false);
          return {
            message: event.message,
            finishReason: event.finishReason,
            rawFinishReason: event.rawFinishReason,
            usage: event.usage,
            model: { provider, id: model },
            prompt: { id: agent.id, version: agent.version },
            remainingToday: null,
          };
        }
        throw failed('The model ended without a final answer.', !answered);
      } catch (error) {
        if (error instanceof ModelStepError) throw error;
        if (stop.aborted) throw new ModelStepError('stopped', 'Stopped.', { upFront: !answered });
        if (timedOut) {
          throw failed(`The model did not answer within ${String(timeoutMs / 1000)} s.`, !answered);
        }
        if (!(error instanceof ModelCallError)) throw error;
        if (!answered && error.failure === 'unavailable' && error.statusCode === 503) {
          throw new ModelStepError('busy', `${model} is busy (HTTP 503).`, { upFront: true });
        }
        if (!answered && error.failure === 'rate-limited') {
          throw new ModelStepError('rate-limited', `${model} refused the request: rate-limited.`, {
            upFront: true,
          });
        }
        throw failed(`The model call failed: ${error.message}.`, !answered);
      } finally {
        clearTimeout(timer);
        stop.removeEventListener('abort', abort);
      }
    },
  };
}
