/**
 * Calls POST /api/ai/step and reads the answer as it streams. The contract is
 * in packages/shared/src/ai/protocol.ts.
 *
 * - It uses fetch rather than EventSource, which can only GET and cannot send
 *   the person's own key in a header.
 * - Every event is validated. Any failure is thrown as an ApiError whose
 *   message can be shown as-is: an HTTP error, a dropped connection, something
 *   unreadable, or the stream's own `error` event. So a consumer only ever sees
 *   text, then one `finish`.
 * - Stopping, through the signal or by leaving the loop early, cancels the
 *   response, and the server then aborts the model call. A stop throws the
 *   signal's reason rather than an ApiError, the way fetch does.
 * - It works the same whether the answer streams in or arrives all at once,
 *   which is what happens when a proxy buffers it.
 * - Failures are AiStepErrors, which say whether the model had started
 *   answering (the AI agent retries a busy model only when it had not) and how
 *   long the server asked to wait.
 */
import {
  AI_KEY_HEADER,
  AI_STEP_PATH,
  aiStreamEventSchema,
  type AiStepRequest,
  type AiStreamEvent,
  type PromptId,
  type PromptInputsFor,
} from '@collabcode/shared';
import { ApiError, readApiError } from '../../lib/api-error.js';
import type { OwnKey } from './byok-store.js';
import { createSseParser } from './sse-parser.js';

/** The one-shot helpers' prompts. The agent's steps also carry a conversation. */
type HelperPromptId = Exclude<PromptId, 'agent'>;

/** One step, typed so its inputs always match the prompt they are for. */
export type AiStep = {
  [Id in HelperPromptId]: { projectId: string; promptId: Id; inputs: PromptInputsFor<Id> };
}[HelperPromptId];

export type AiAnswerEvent = Exclude<AiStreamEvent, { type: 'error' }>;
export type AiFinish = Extract<AiStreamEvent, { type: 'finish' }>;

/** A request body, without the own-key choice, which comes from `ownKey`. */
export type AiRequestBody = Omit<AiStepRequest, 'byok'>;

export type StreamAiRequestOptions = {
  apiUrl: string;
  body: AiRequestBody;
  /** The person's own key, or null to use the shared free tier. */
  ownKey: OwnKey | null;
  signal: AbortSignal;
  fetch?: typeof fetch;
};

export type StreamAiStepOptions = Omit<StreamAiRequestOptions, 'body'> & { step: AiStep };

/** A failed AI request, with a message to show as it is. */
export class AiStepError extends ApiError {
  /** The model had not started answering: nothing was spent on an answer. */
  readonly upFront: boolean;
  /** How long the server asked to wait (Retry-After), when it said. */
  readonly retryAfterMs: number | null;

  constructor(
    code: ApiError['code'],
    message: string,
    options: { upFront: boolean; retryAfterMs?: number | null },
  ) {
    super(code, message);
    this.name = 'AiStepError';
    this.upFront = options.upFront;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

const UNREADABLE = 'The AI answer arrived in a form we could not read. Try again.';

function retryAfterMs(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : null;
}

function requestInit(body: AiRequestBody, ownKey: OwnKey | null, signal: AbortSignal): RequestInit {
  const request: AiStepRequest = { ...body, byok: ownKey?.choice };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // The key travels only in its header, never in the body.
  if (ownKey) headers[AI_KEY_HEADER] = ownKey.key;
  return { method: 'POST', headers, body: JSON.stringify(request), signal };
}

function parseEvent(data: string): AiStreamEvent {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new AiStepError('malformed-response', UNREADABLE, { upFront: false });
  }
  const parsed = aiStreamEventSchema.safeParse(json);
  if (!parsed.success) throw new AiStepError('malformed-response', UNREADABLE, { upFront: false });
  return parsed.data;
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read();
  } catch {
    signal.throwIfAborted();
    throw new AiStepError(
      'network',
      'The connection dropped before the answer finished. Try again.',
      { upFront: false },
    );
  }
}

/** One request to the step endpoint, for any prompt. */
export async function* streamAiRequest({
  apiUrl,
  body,
  ownKey,
  signal,
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
}: StreamAiRequestOptions): AsyncGenerator<AiAnswerEvent, void, undefined> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${AI_STEP_PATH}`, requestInit(body, ownKey, signal));
  } catch {
    signal.throwIfAborted();
    throw new AiStepError('network', 'Could not reach the server. Check your connection.', {
      upFront: true,
    });
  }
  if (!response.ok) {
    const error = await readApiError(response);
    throw new AiStepError(error.code, error.message, {
      upFront: true,
      retryAfterMs: retryAfterMs(response),
    });
  }
  const isStream = response.headers.get('content-type')?.startsWith('text/event-stream') ?? false;
  if (!isStream || response.body === null) {
    throw new AiStepError('malformed-response', UNREADABLE, { upFront: true });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const chunk = await readChunk(reader, signal);
      if (chunk.done) break;
      for (const data of parser.push(decoder.decode(chunk.value, { stream: true }))) {
        const event = parseEvent(data);
        if (event.type === 'error') {
          throw new AiStepError(event.error.code, event.error.message, { upFront: false });
        }
        yield event;
        if (event.type === 'finish') return;
      }
    }
    throw new AiStepError(
      'network',
      'The connection closed before the answer finished. Try again.',
      { upFront: false },
    );
  } finally {
    reader.cancel().catch(() => {
      // Cancelling only releases the connection; a stream that already failed holds none.
    });
  }
}

/** One of the one-shot helpers' steps. */
export function streamAiStep({
  step,
  ...options
}: StreamAiStepOptions): AsyncGenerator<AiAnswerEvent, void, undefined> {
  return streamAiRequest({ ...options, body: step });
}
