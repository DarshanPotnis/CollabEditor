import { AI_KEY_HEADER, type AiStreamEvent } from '@collabcode/shared';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '../../lib/api-error.js';
import { AiStepError, streamAiStep, type AiAnswerEvent, type AiStep } from './ai-client.js';
import type { OwnKey } from './byok-store.js';

const API_URL = 'http://api.test';

const STEP: AiStep = {
  projectId: 'abc123',
  promptId: 'explain-selection',
  inputs: { path: 'index.js', language: 'javascript', startLine: 1, selection: 'let x = 1;' },
};

const OWN_KEY: OwnKey = {
  choice: { provider: 'openai', model: 'gpt-5.4-mini' },
  key: 'sk-canary-4d1f9b',
};

const FINISH: AiStreamEvent = {
  type: 'finish',
  finishReason: 'stop',
  usage: { inputTokens: 12, outputTokens: 3 },
  prompt: { id: 'explain-selection', version: 1 },
  model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
  remainingToday: 29,
};

function sse(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

/** A body that delivers these byte pieces one read at a time. */
function bodyOf(pieces: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream({
    pull(controller) {
      const piece = pieces[next++];
      if (piece) controller.enqueue(piece);
      else controller.close();
    },
    cancel: onCancel,
  });
}

function streamResponse(body: ReadableStream<Uint8Array> | string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function fakeFetch(response: Response): Mock<typeof fetch> {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

async function collect(
  fetch: typeof globalThis.fetch,
  options: { ownKey?: OwnKey | null; signal?: AbortSignal } = {},
): Promise<AiAnswerEvent[]> {
  const events: AiAnswerEvent[] = [];
  for await (const event of streamAiStep({
    apiUrl: API_URL,
    step: STEP,
    ownKey: options.ownKey ?? null,
    signal: options.signal ?? new AbortController().signal,
    fetch,
  })) {
    events.push(event);
  }
  return events;
}

async function failure(
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<{ error: unknown; events: AiAnswerEvent[] }> {
  const events: AiAnswerEvent[] = [];
  try {
    for await (const event of streamAiStep({
      apiUrl: API_URL,
      step: STEP,
      ownKey: null,
      signal: signal ?? new AbortController().signal,
      fetch,
    })) {
      events.push(event);
    }
  } catch (error) {
    return { error, events };
  }
  throw new Error('expected the stream to fail');
}

describe('streamAiStep: reading the answer', () => {
  const text = 'Déjà vu 🎉 done';
  const stream = sse(
    { type: 'text-delta', text: text.slice(0, 8) },
    { type: 'text-delta', text: text.slice(8) },
    FINISH,
  );
  const expected = [
    { type: 'text-delta', text: text.slice(0, 8) },
    { type: 'text-delta', text: text.slice(8) },
    FINISH,
  ];

  it('yields the text, then the finish', async () => {
    expect(await collect(fakeFetch(streamResponse(stream)))).toEqual(expected);
  });

  it('gives the same events when the stream arrives in one buffered piece', async () => {
    const bytes = new TextEncoder().encode(stream);
    expect(await collect(fakeFetch(streamResponse(bodyOf([bytes]))))).toEqual(expected);
  });

  it('gives the same events when chunks split events and characters', async () => {
    const bytes = new TextEncoder().encode(stream);
    const pieces: Uint8Array[] = [];
    // Three-byte pieces cut through the multi-byte characters as well as the events.
    for (let at = 0; at < bytes.length; at += 3) pieces.push(bytes.slice(at, at + 3));
    expect(await collect(fakeFetch(streamResponse(bodyOf(pieces))))).toEqual(expected);
  });

  it('stops reading at the finish and releases the connection', async () => {
    const cancel = vi.fn();
    // The second piece stays unread, so the body is still open when the client lets go.
    const pieces = [
      new TextEncoder().encode(sse(FINISH, { type: 'text-delta', text: 'late' })),
      new TextEncoder().encode(sse({ type: 'text-delta', text: 'later' })),
    ];
    const events = await collect(fakeFetch(streamResponse(bodyOf(pieces, cancel))));
    expect(events).toEqual([FINISH]);
    expect(cancel).toHaveBeenCalled();
  });

  it('releases the connection when the consumer stops early', async () => {
    const cancel = vi.fn();
    const pieces = [
      new TextEncoder().encode(sse({ type: 'text-delta', text: 'one' })),
      new TextEncoder().encode(sse({ type: 'text-delta', text: 'two' })),
    ];
    const events = streamAiStep({
      apiUrl: API_URL,
      step: STEP,
      ownKey: null,
      signal: new AbortController().signal,
      fetch: fakeFetch(streamResponse(bodyOf(pieces, cancel))),
    });
    for await (const event of events) {
      expect(event).toEqual({ type: 'text-delta', text: 'one' });
      break;
    }
    expect(cancel).toHaveBeenCalled();
  });
});

function sentRequest(fetch: Mock<typeof globalThis.fetch>): {
  url: unknown;
  init: RequestInit;
  body: string;
} {
  const [url, init] = fetch.mock.calls[0] ?? [];
  if (typeof init?.body !== 'string') throw new Error('expected a JSON body');
  return { url, init, body: init.body };
}

describe('streamAiStep: the request', () => {
  it('posts the step to the AI route with no key', async () => {
    const fetch = fakeFetch(streamResponse(sse(FINISH)));
    await collect(fetch);
    const { url, init, body } = sentRequest(fetch);
    expect(url).toBe(`${API_URL}/api/ai/step`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(body)).toEqual(STEP);
    expect(init.headers).not.toHaveProperty(AI_KEY_HEADER);
  });

  it('sends an own key only in its header, with the choice in the body', async () => {
    const fetch = fakeFetch(streamResponse(sse(FINISH)));
    await collect(fetch, { ownKey: OWN_KEY });
    const { init, body } = sentRequest(fetch);
    expect(init.headers).toMatchObject({ [AI_KEY_HEADER]: OWN_KEY.key });
    expect(JSON.parse(body)).toEqual({ ...STEP, byok: OWN_KEY.choice });
    expect(body).not.toContain(OWN_KEY.key);
  });
});

describe('streamAiStep: failures', () => {
  it("throws the server's error for an HTTP failure", async () => {
    const response = Response.json(
      { error: { code: 'quota-exhausted', message: 'Daily allowance used.' } },
      { status: 429 },
    );
    const { error } = await failure(fakeFetch(response));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'quota-exhausted', message: 'Daily allowance used.' });
  });

  it('names the status when an HTTP failure has no readable error', async () => {
    const { error } = await failure(fakeFetch(new Response('<html>', { status: 502 })));
    expect(error).toMatchObject({ code: 'internal', message: 'The server answered with 502.' });
  });

  it('reports an unreachable server as a network failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    const { error } = await failure(fetch);
    expect(error).toMatchObject({ code: 'network' });
  });

  it("throws the stream's error event after the text before it", async () => {
    const stream = sse(
      { type: 'text-delta', text: 'partial' },
      {
        type: 'error',
        error: { code: 'unavailable', message: 'The AI provider is not answering.' },
      },
    );
    const { error, events } = await failure(fakeFetch(streamResponse(stream)));
    expect(events).toEqual([{ type: 'text-delta', text: 'partial' }]);
    expect(error).toMatchObject({
      code: 'unavailable',
      message: 'The AI provider is not answering.',
    });
  });

  it.each([
    ['is not JSON', 'data: {oops\n\n'],
    ['does not match the protocol', sse({ type: 'text-delta', text: 42 })],
    ['has an unknown type', sse({ type: 'tool-call' })],
  ])('refuses an event that %s', async (_label, stream) => {
    const { error } = await failure(fakeFetch(streamResponse(stream)));
    expect(error).toMatchObject({ code: 'malformed-response' });
  });

  it('refuses a success that is not an event stream', async () => {
    const { error } = await failure(fakeFetch(Response.json({ ok: true })));
    expect(error).toMatchObject({ code: 'malformed-response' });
  });

  it('reports a stream that ends without finishing', async () => {
    const { error, events } = await failure(
      fakeFetch(streamResponse(sse({ type: 'text-delta', text: 'cut' }))),
    );
    expect(events).toHaveLength(1);
    expect(error).toMatchObject({ code: 'network' });
  });

  it('reports a connection that drops mid-stream', async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new TypeError('network error'));
          return;
        }
        sent = true;
        controller.enqueue(new TextEncoder().encode(sse({ type: 'text-delta', text: 'a' })));
      },
    });
    const { error } = await failure(fakeFetch(streamResponse(body)));
    expect(error).toMatchObject({ code: 'network' });
  });
});

describe('streamAiStep: stopping', () => {
  it('throws the abort, not an ApiError, when stopped before an answer', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      controller.abort();
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    const { error } = await failure(fetch, controller.signal);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('throws the abort, not an ApiError, when stopped mid-stream', async () => {
    const controller = new AbortController();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        if (sent) {
          controller.abort();
          stream.error(controller.signal.reason);
          return;
        }
        sent = true;
        stream.enqueue(new TextEncoder().encode(sse({ type: 'text-delta', text: 'a' })));
      },
    });
    const { error, events } = await failure(fakeFetch(streamResponse(body)), controller.signal);
    expect(events).toHaveLength(1);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });
});

describe('what a failure says', () => {
  async function failure(fetch: typeof globalThis.fetch): Promise<AiStepError> {
    try {
      await collect(fetch);
    } catch (error) {
      if (error instanceof AiStepError) return error;
      throw error;
    }
    throw new Error('expected the request to fail');
  }

  it('marks a refusal before any answer as up front, with how long to wait', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'rate-limited', message: 'Busy minute.' } }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '45' } },
    );
    const error = await failure(fakeFetch(response));
    expect(error).toMatchObject({ code: 'rate-limited', upFront: true, retryAfterMs: 45_000 });
    expect(error).toBeInstanceOf(ApiError);
  });

  it('marks a failure in the stream as not up front: the model had started', async () => {
    const response = streamResponse(
      sse(
        { type: 'text-delta', text: 'Half' },
        { type: 'error', error: { code: 'busy', message: 'Busy.' } },
      ),
    );
    expect(await failure(fakeFetch(response))).toMatchObject({
      code: 'busy',
      upFront: false,
      retryAfterMs: null,
    });
  });
});
