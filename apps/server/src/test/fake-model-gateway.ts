/**
 * A scripted ModelGateway for the integration tests and the end-to-end server:
 * no network, no key, and the same answer every time. Like e2e-server.ts it
 * lives in test/, so it is never part of the server bundle.
 */
import type { AiFinishReason, AssistantMessage } from '@collabcode/shared';
import {
  ModelCallError,
  type ModelCall,
  type ModelCallFailure,
  type ModelEvent,
  type ModelGateway,
} from '../ai/model-gateway.js';

export type FakeReply =
  | {
      kind: 'text';
      chunks: string[];
      finishReason?: AiFinishReason;
      delayMs?: number;
      /** For a call with tools: the model's whole message. Defaults to the chunks as text. */
      message?: AssistantMessage;
    }
  | { kind: 'fail'; failure: ModelCallFailure; statusCode?: number; afterChunks?: string[] };

/** A reply that calls tools, the way the agent's model does. */
export function toolCallReply(
  calls: Array<{ toolName: string; input: unknown; toolCallId?: string }>,
  text = '',
): FakeReply {
  return {
    kind: 'text',
    chunks: text === '' ? [] : [text],
    finishReason: 'tool-calls',
    message: {
      role: 'assistant',
      parts: [
        ...(text === '' ? [] : [{ type: 'text' as const, text }]),
        ...calls.map((call, index) => ({
          type: 'tool-call' as const,
          toolCallId: call.toolCallId ?? `call-${String(index + 1)}`,
          toolName: call.toolName,
          input: call.input,
        })),
      ],
    },
  };
}

export type FakeModelGateway = ModelGateway & {
  /** Every call made, keys included, so tests can check what reached the provider. */
  calls: ModelCall[];
};

const DEFAULT_REPLY: FakeReply = { kind: 'text', chunks: ['A fake ', 'answer.'] };

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ModelCallError('aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ModelCallError('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createFakeModelGateway(
  reply: (call: ModelCall) => FakeReply = () => DEFAULT_REPLY,
): FakeModelGateway {
  const calls: ModelCall[] = [];
  return {
    calls,
    async *stream(call): AsyncGenerator<ModelEvent> {
      calls.push(call);
      const script = reply(call);
      const chunks = script.kind === 'text' ? script.chunks : (script.afterChunks ?? []);
      const delayMs = script.kind === 'text' ? (script.delayMs ?? 0) : 0;

      for (const text of chunks) {
        await wait(delayMs, call.signal);
        yield { type: 'text-delta', text };
      }
      await wait(delayMs, call.signal);
      if (script.kind === 'fail') throw new ModelCallError(script.failure, script.statusCode);

      const text = chunks.join('');
      yield {
        type: 'finish',
        finishReason: script.finishReason ?? 'stop',
        rawFinishReason: null,
        usage: { inputTokens: 100, outputTokens: chunks.length },
        ...(call.toolUse && {
          message: script.message ?? {
            role: 'assistant',
            parts: text === '' ? [] : [{ type: 'text', text }],
          },
        }),
      };
    },
  };
}
