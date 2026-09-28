/**
 * A ModelClient that plays back answers written in advance: the deterministic
 * model for tests, and the source of a replay (AI-5's "Watch a demo"), which
 * feeds a recorded trace's answers to a real ToolHost with no model at all.
 */
import {
  PROMPTS,
  type AiFinishReason,
  type AssistantMessage,
  type ToolCallPart,
} from '@collabcode/shared';
import type { AgentTrace } from './trace.js';
import {
  ModelStepError,
  type ModelClient,
  type ModelStep,
  type ModelStepRequest,
  type StopSignal,
  type TokenUsage,
} from './types.js';

export type ScriptedAnswer = {
  message: AssistantMessage;
  finishReason?: AiFinishReason;
  usage?: TokenUsage;
  /** Streamed before the answer, as the model's text. */
  text?: readonly string[];
};

export type ScriptedReply = ScriptedAnswer | { error: ModelStepError };

/** A step of the script: a fixed reply, or one worked out from the request. */
export type ScriptEntry =
  ScriptedReply | ((request: ModelStepRequest) => ScriptedReply | Promise<ScriptedReply>);

export type ScriptedModel = ModelClient & {
  /** Every request, as it was when made. */
  requests: ModelStepRequest[];
};

export const SCRIPTED_MODEL = { provider: 'gemini', id: 'scripted' } as const;

/** Rejects once `signal` stops; never settles otherwise. */
function untilStopped(signal: StopSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new ModelStepError('stopped', 'Stopped.', { upFront: false })),
      { once: true },
    );
  });
}

export function createScriptedModel(
  script: readonly ScriptEntry[],
  model: ModelStep['model'] = SCRIPTED_MODEL,
): ScriptedModel {
  const requests: ModelStepRequest[] = [];
  let next = 0;
  return {
    requests,
    async step(request) {
      requests.push({ ...request, conversation: [...request.conversation] });
      const entry = script[next];
      next += 1;
      if (entry === undefined) {
        throw new ModelStepError('failed', 'The scripted model has no more answers.', {
          upFront: true,
        });
      }
      if (request.signal.aborted) {
        throw new ModelStepError('stopped', 'Stopped.', { upFront: true });
      }
      const reply = await Promise.race([
        Promise.resolve(typeof entry === 'function' ? entry(request) : entry),
        untilStopped(request.signal),
      ]);
      if ('error' in reply) throw reply.error;
      for (const delta of reply.text ?? []) request.onText(delta);
      return {
        message: reply.message,
        finishReason: reply.finishReason ?? 'tool-calls',
        usage: reply.usage ?? { inputTokens: 1_000, outputTokens: 50 },
        model,
        prompt: { id: PROMPTS.agent.id, version: PROMPTS.agent.version },
        remainingToday: null,
      };
    },
  };
}

/** Plays back a recorded session's answers, in order. */
export function scriptFromTrace(trace: AgentTrace): ScriptedModel {
  const answers = trace.steps.flatMap((step): ScriptedAnswer[] =>
    step.model === null
      ? []
      : [
          {
            message: step.model.message,
            finishReason: step.model.finishReason,
            usage: step.model.usage,
          },
        ],
  );
  const first = trace.steps.find((step) => step.model !== null)?.model;
  return createScriptedModel(
    answers,
    first ? { provider: first.provider, id: first.id } : SCRIPTED_MODEL,
  );
}

let callIds = 0;

/** A tool call, for writing scripts. */
export function toolCall(toolName: string, input: unknown, toolCallId?: string): ToolCallPart {
  callIds += 1;
  return {
    type: 'tool-call',
    toolCallId: toolCallId ?? `call-${String(callIds)}`,
    toolName,
    input,
  };
}

/** A model message calling the given tools, optionally after some text it streams first. */
export function answerWith(calls: readonly ToolCallPart[], text?: string): ScriptedAnswer {
  return {
    message: {
      role: 'assistant',
      parts: [...(text === undefined ? [] : [{ type: 'text' as const, text }]), ...calls],
    },
    ...(text === undefined ? {} : { text: [text] }),
  };
}
