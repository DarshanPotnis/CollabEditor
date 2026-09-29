/**
 * For the model client's specs: a ModelGateway that answers from a script and
 * records every call, key included, so a spec can check where the key went.
 */
import {
  ModelCallError,
  type ModelCall,
  type ModelEvent,
  type ModelGateway,
} from '@collabcode/model-gateway';
import type { AssistantMessage } from '@collabcode/shared';

export type FakeAnswer =
  | { kind: 'answer'; message: AssistantMessage; text?: string }
  | { kind: 'fail'; error: ModelCallError; afterText?: string }
  | { kind: 'hang' };

export function createFakeGateway(answers: FakeAnswer[]): ModelGateway & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    calls,
    async *stream(call): AsyncGenerator<ModelEvent> {
      calls.push(call);
      const answer = answers.shift() ?? { kind: 'hang' };
      if (answer.kind === 'hang') {
        await new Promise<void>((_resolve, reject) => {
          call.signal.addEventListener('abort', () => reject(new ModelCallError('aborted')), {
            once: true,
          });
        });
        return;
      }
      if (answer.kind === 'fail') {
        if (answer.afterText !== undefined) yield { type: 'text-delta', text: answer.afterText };
        throw answer.error;
      }
      if (answer.text !== undefined) yield { type: 'text-delta', text: answer.text };
      yield {
        type: 'finish',
        finishReason: 'tool-calls',
        rawFinishReason: 'STOP',
        usage: { inputTokens: 100, outputTokens: 10 },
        message: answer.message,
      };
    },
  };
}
