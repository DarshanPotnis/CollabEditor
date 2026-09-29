import {
  createFakeClock,
  createStopSource,
  runAgent,
  type FakeClock,
  type ToolHost,
} from '@collabcode/agent';
import { AI_KEY_HEADER, type AiStreamEvent, type AssistantMessage } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import type { OwnKey } from '../ai/byok-store.js';
import { createHttpModelClient } from './http-model-client.js';

const KEY = 'sk-ant-trace-canary-7c21';
const OWN_KEY: OwnKey = { choice: { provider: 'anthropic', model: 'claude-sonnet-5' }, key: KEY };

function message(toolName: string, input: unknown, id: string): AssistantMessage {
  return {
    role: 'assistant',
    parts: [
      {
        type: 'tool-call',
        toolCallId: id,
        toolName,
        input,
        providerOptions: { google: { thoughtSignature: `sig-${id}` } },
      },
    ],
  };
}

function finishEvent(answer: AssistantMessage, model = 'gemini-3.1-flash-lite'): AiStreamEvent {
  return {
    type: 'finish',
    finishReason: 'tool-calls',
    usage: { inputTokens: 900, outputTokens: 20 },
    prompt: { id: 'agent', version: 1 },
    model: { provider: 'gemini', id: model },
    remainingToday: 20,
    message: answer,
  };
}

type Sent = { headers: Record<string, string>; body: string };

/** A server that answers each request with the next reply. */
function fakeServer(replies: Array<() => Response>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  let next = 0;
  const fakeFetch: typeof fetch = (_url, init) => {
    sent.push({
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const reply = replies[next] ?? replies.at(-1);
    next += 1;
    if (!reply) throw new Error('no reply');
    return Promise.resolve(reply());
  };
  return { fetch: fakeFetch, sent };
}

const stream =
  (...events: AiStreamEvent[]) =>
  (): Response =>
    new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });

const refusal = (status: number, code: string, retryAfter?: string) => (): Response =>
  new Response(JSON.stringify({ error: { code, message: `Refused: ${code}.` } }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(retryAfter === undefined ? {} : { 'retry-after': retryAfter }),
    },
  });

const tools: ToolHost = {
  execute: (call) => Promise.resolve({ ok: true, output: `${call.name}: const users = [];` }),
};

async function drive<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let turn = 0; turn < 200 && !settled; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = clock.nextWakeAt();
    if (!settled && next !== null) clock.advance(next - clock.now());
  }
  return promise;
}

function session(fetch: typeof globalThis.fetch, ownKey: OwnKey | null) {
  const clock = createFakeClock(1_700_000_000_000);
  const model = createHttpModelClient({
    apiUrl: 'http://api.test',
    projectId: 'p1',
    sessionId: 's1',
    ownKey,
    fetch,
  });
  return drive(
    clock,
    runAgent({
      sessionId: 's1',
      inputs: { goal: 'Add a route', files: ['routes/users.js'] },
      tier: ownKey ? 'ownKey' : 'shared',
      model,
      tools,
      clock,
      stop: createStopSource().signal,
      project: { template: 'express-api', filesFingerprint: 'f' },
      random: () => 0.5,
    }),
  );
}

const read = message('read_file', { path: 'routes/users.js' }, 'c1');
const done = message('finish', { summary: 'Done.' }, 'c2');

describe('the browser model client', () => {
  it('sends the conversation back unchanged, and pins the shared model the session started on', async () => {
    const server = fakeServer([stream(finishEvent(read)), stream(finishEvent(done))]);
    const { outcome } = await session(server.fetch, null);

    expect(outcome).toEqual({
      kind: 'finished',
      summary: 'Done.',
      checks: { made: [], notMade: [] },
    });
    const [first, second] = server.sent.map(
      (entry) => JSON.parse(entry.body) as Record<string, unknown>,
    );
    expect(first).toMatchObject({ promptId: 'agent', sessionId: 's1', conversation: [] });
    expect(first).not.toHaveProperty('sharedModel');
    expect(second).toMatchObject({ sharedModel: 'gemini-3.1-flash-lite' });
    expect((second?.['conversation'] as unknown[])[0]).toEqual(read);
  });

  it('keeps the own key in its header only: never in a body, never in the trace', async () => {
    const server = fakeServer([stream(finishEvent(read)), stream(finishEvent(done))]);
    const { trace } = await session(server.fetch, OWN_KEY);

    expect(server.sent.every((entry) => entry.headers[AI_KEY_HEADER] === KEY)).toBe(true);
    expect(server.sent.some((entry) => entry.body.includes(KEY))).toBe(false);
    expect(JSON.stringify(trace)).not.toContain(KEY);
    expect(JSON.parse(server.sent[1]?.body ?? '{}')).not.toHaveProperty('sharedModel');
  });

  it('lets the core retry a model that was busy before answering', async () => {
    const server = fakeServer([
      refusal(503, 'busy'),
      stream(finishEvent(read)),
      stream(finishEvent(done)),
    ]);
    const { outcome, trace } = await session(server.fetch, null);
    expect(outcome.kind).toBe('finished');
    expect(trace.steps[0]?.waits).toMatchObject([{ reason: 'busy', waitMs: 5_000 }]);
  });

  it('waits out a per-minute limit for as long as the server says', async () => {
    const server = fakeServer([
      refusal(429, 'rate-limited', '30'),
      stream(finishEvent(read)),
      stream(finishEvent(done)),
    ]);
    const { trace } = await session(server.fetch, null);
    expect(trace.steps[0]?.waits).toMatchObject([{ reason: 'rate-limited', waitMs: 30_500 }]);
  });

  it('ends the session with the server’s message for anything else', async () => {
    const server = fakeServer([refusal(429, 'quota-exhausted')]);
    expect((await session(server.fetch, null)).outcome).toEqual({
      kind: 'failed',
      reason: 'model',
      message: 'Refused: quota-exhausted.',
    });
  });
});
