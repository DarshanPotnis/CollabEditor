/**
 * A scripted ModelGateway for the integration tests and the end-to-end server:
 * no network, no key, and the same answer every time. Like e2e-server.ts it
 * lives in test/, so it is never part of the server bundle.
 */
import type { AiFinishReason } from '@collabcode/shared';
import {
  ModelCallError,
  type ModelCall,
  type ModelCallFailure,
  type ModelEvent,
  type ModelGateway,
} from '../ai/model-gateway.js';

export type FakeReply =
  | { kind: 'text'; chunks: string[]; finishReason?: AiFinishReason; delayMs?: number }
  | { kind: 'fail'; failure: ModelCallFailure; statusCode?: number; afterChunks?: string[] };

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

      yield {
        type: 'finish',
        finishReason: script.finishReason ?? 'stop',
        usage: { inputTokens: 100, outputTokens: chunks.length },
      };
    },
  };
}
