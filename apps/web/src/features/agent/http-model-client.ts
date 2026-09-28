/**
 * The agent's ModelClient in the browser: one POST to /api/ai/step per step,
 * read as it streams, through the same client as the one-shot helpers.
 *
 * - The key choice is fixed for the session: the conversation carries the
 *   first model's thought signatures, so switching keys or models part way
 *   would break it. The key itself travels only in its header, never in a
 *   body, so it is never in the conversation or the trace.
 * - On the shared tier, later steps name the model the first one used, since
 *   the server may have answered it from its fallback model (sharedModel).
 * - Failures become ModelStepErrors the core can act on: a busy model or a
 *   per-minute limit before any answer can be waited out; anything else ends
 *   the session with the server's own message.
 */
import { ModelStepError, type ModelClient, type ModelStepErrorKind } from '@collabcode/agent';
import { ApiError } from '../../lib/api-error.js';
import { AiStepError, streamAiRequest, type AiRequestBody } from '../ai/ai-client.js';
import type { OwnKey } from '../ai/byok-store.js';
import { abortSignalFor } from './abort-signal.js';

export type HttpModelClientOptions = {
  apiUrl: string;
  projectId: string;
  sessionId: string;
  /** The person's own key for the whole session, or null for the shared tier. */
  ownKey: OwnKey | null;
  fetch?: typeof fetch;
};

const UNREADABLE = 'The AI answer arrived in a form we could not read. Try again.';

function kindOf(error: AiStepError): ModelStepErrorKind {
  if (error.code === 'busy') return 'busy';
  if (error.code === 'rate-limited') return 'rate-limited';
  return 'failed';
}

export function createHttpModelClient({
  apiUrl,
  projectId,
  sessionId,
  ownKey,
  fetch,
}: HttpModelClientOptions): ModelClient {
  /** The shared model this session started on, once its first step has said. */
  let sharedModel: string | null = null;

  return {
    async step({ inputs, conversation, signal: stop, onText }) {
      const { signal, dispose } = abortSignalFor(stop);
      const body: AiRequestBody = {
        projectId,
        promptId: 'agent',
        inputs,
        conversation: [...conversation],
        sessionId,
        ...(ownKey === null && sharedModel !== null ? { sharedModel } : {}),
      };
      try {
        for await (const event of streamAiRequest({
          apiUrl,
          body,
          ownKey,
          signal,
          ...(fetch ? { fetch } : {}),
        })) {
          if (event.type === 'text-delta') {
            onText(event.text);
            continue;
          }
          if (!event.message) throw new ModelStepError('failed', UNREADABLE, { upFront: false });
          if (ownKey === null) sharedModel ??= event.model.id;
          return {
            message: event.message,
            finishReason: event.finishReason,
            usage: event.usage,
            model: event.model,
            prompt: event.prompt,
            remainingToday: event.remainingToday,
          };
        }
        throw new ModelStepError('failed', UNREADABLE, { upFront: false });
      } catch (error) {
        if (stop.aborted) throw new ModelStepError('stopped', 'Stopped.', { upFront: true });
        if (error instanceof ModelStepError) throw error;
        if (error instanceof AiStepError) {
          throw new ModelStepError(kindOf(error), error.message, {
            upFront: error.upFront,
            retryAfterMs: error.retryAfterMs,
          });
        }
        if (error instanceof ApiError) {
          throw new ModelStepError('failed', error.message, { upFront: false });
        }
        throw error;
      } finally {
        dispose();
      }
    },
  };
}
