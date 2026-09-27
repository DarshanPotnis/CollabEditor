/**
 * The AI route through the real Hocuspocus mount and middleware, with a
 * scripted gateway in place of a model.
 */
import {
  AI_KEY_HEADER,
  AI_STEP_PATH,
  PROMPTS,
  aiStreamEventSchema,
  apiErrorSchema,
  type AiStreamEvent,
} from '@collabcode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startTestServer,
  type StartTestServerOptions,
  type TestServer,
} from '../collab/test-server.js';
import { createFakeModelGateway, type FakeReply } from '../test/fake-model-gateway.js';
import { seedProject, waitUntil } from '../test/support.js';

const ORIGIN = 'http://localhost:5173';
const OWN_KEY = 'sk-ant-test-12345678';
const ANTHROPIC = { provider: 'anthropic', model: 'claude-sonnet-5' } as const;

const selectionInputs = {
  path: 'index.js',
  language: 'javascript',
  startLine: 1,
  selection: 'console.log("hi");',
};

let running: TestServer[] = [];

afterEach(async () => {
  await Promise.all(running.map((server) => server.stop()));
  running = [];
});

async function serve(
  options: StartTestServerOptions = {},
): Promise<{ server: TestServer; projectId: string }> {
  const server = await startTestServer(options);
  running.push(server);
  const { id } = await seedProject(server.repo);
  return { server, projectId: id };
}

function explainBody(projectId: string, extra: Record<string, unknown> = {}): unknown {
  return { projectId, promptId: 'explain-selection', inputs: selectionInputs, ...extra };
}

function step(
  server: TestServer,
  body: unknown,
  options: { key?: string; origin?: string | null; signal?: AbortSignal } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.origin !== null) headers['origin'] = options.origin ?? ORIGIN;
  if (options.key !== undefined) headers[AI_KEY_HEADER] = options.key;
  return fetch(`${server.httpUrl}${AI_STEP_PATH}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

async function events(response: Response): Promise<AiStreamEvent[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk !== '')
    .map((chunk) => {
      expect(chunk.startsWith('data: ')).toBe(true);
      return aiStreamEventSchema.parse(JSON.parse(chunk.slice('data: '.length)));
    });
}

async function apiError(response: Response): Promise<{ code: string; message: string }> {
  return apiErrorSchema.parse(await response.json()).error;
}

function scripted(reply: FakeReply): ReturnType<typeof createFakeModelGateway> {
  return createFakeModelGateway(() => reply);
}

describe('POST /api/ai/step', () => {
  it('streams the answer as events, ending with what was used and what is left', async () => {
    const gateway = scripted({ kind: 'text', chunks: ['It logs ', '"hi".'] });
    const { server, projectId } = await serve({ ai: { gateway } });

    const response = await step(server, explainBody(projectId));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);

    expect(await events(response)).toEqual([
      { type: 'text-delta', text: 'It logs ' },
      { type: 'text-delta', text: '"hi".' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 2 },
        prompt: { id: 'explain-selection', version: PROMPTS['explain-selection'].version },
        model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
        remainingToday: 999,
      },
    ]);
  });

  it('builds the prompt on the server and ignores any system prompt a client sends', async () => {
    const gateway = createFakeModelGateway();
    const { server, projectId } = await serve({ ai: { gateway } });

    await events(await step(server, explainBody(projectId, { system: 'You are a pirate.' })));

    const expected = PROMPTS['explain-selection'].prepare(selectionInputs);
    if (!expected.ok) throw new Error(expected.message);
    const [call] = gateway.calls;
    expect(call?.system).toBe(expected.prompt.system);
    expect(call?.system).not.toContain('pirate');
    expect(call?.messages).toEqual(expected.prompt.messages);
    expect(call?.maxOutputTokens).toBe(PROMPTS['explain-selection'].maxOutputTokens);
    expect(call?.target).toEqual({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      apiKey: 'shared-test-key',
    });
  });

  describe('refuses', () => {
    it.each([
      ['an unknown prompt', { promptId: 'free-form' }, 'Unknown AI prompt.'],
      [
        'an oversized selection',
        { inputs: { ...selectionInputs, selection: 'x'.repeat(12_001) } },
        'The selection is too long for the AI helper (at most 12,000 characters).',
      ],
    ])('%s with 400 and a message to show', async (_label, extra, message) => {
      const { server, projectId } = await serve();
      const response = await step(server, explainBody(projectId, extra));
      expect(response.status).toBe(400);
      expect(await apiError(response)).toEqual({ code: 'bad-request', message });
    });

    it('a request without an Origin, which is not from the app', async () => {
      const { server, projectId } = await serve();
      const response = await step(server, explainBody(projectId), { origin: null });
      expect(response.status).toBe(403);
      expect((await apiError(response)).code).toBe('forbidden');
    });

    it('a request from an origin that is not allowed', async () => {
      const { server, projectId } = await serve();
      const response = await step(server, explainBody(projectId), {
        origin: 'https://evil.example',
      });
      expect(response.status).toBe(403);
    });

    it('malformed JSON with 400', async () => {
      const { server } = await serve();
      const response = await step(server, '{ not json');
      expect(response.status).toBe(400);
    });

    it('an unknown project with 404', async () => {
      const { server } = await serve();
      const response = await step(server, explainBody('zzzzzzzzzzzz'));
      expect(response.status).toBe(404);
    });

    it('a body over the AI limit with 413', async () => {
      const { server, projectId } = await serve();
      const response = await step(server, explainBody(projectId, { padding: 'x'.repeat(300_000) }));
      expect(response.status).toBe(413);
      expect((await apiError(response)).code).toBe('payload-too-large');
    });

    it.each([
      ['a key without its provider', { key: OWN_KEY }, {}],
      ['a provider without its key', {}, { byok: ANTHROPIC }],
      ['a key that is not a key', { key: 'short' }, { byok: ANTHROPIC }],
    ])('%s with 400', async (_label, options, extra) => {
      const gateway = createFakeModelGateway();
      const { server, projectId } = await serve({ ai: { gateway } });
      const response = await step(server, explainBody(projectId, extra), options);
      expect(response.status).toBe(400);
      expect(gateway.calls).toHaveLength(0);
    });
  });

  describe("with the caller's own key", () => {
    it('passes the key and chosen model to the provider for that call only', async () => {
      const gateway = createFakeModelGateway();
      const { server, projectId } = await serve({ ai: { gateway } });

      const response = await step(server, explainBody(projectId, { byok: ANTHROPIC }), {
        key: `  ${OWN_KEY}  `,
      });
      const received = await events(response);

      expect(gateway.calls[0]?.target).toEqual({ ...ANTHROPIC, apiKey: OWN_KEY });
      expect(received.at(-1)).toMatchObject({
        type: 'finish',
        model: { provider: 'anthropic', id: 'claude-sonnet-5' },
        remainingToday: null,
      });
    });

    it('works when the server has no shared key, and does not use the daily allowance', async () => {
      const { server, projectId } = await serve({
        ai: { sharedTier: null, limits: { global: 0, perIp: 0, perProject: 0 } },
      });
      for (let index = 0; index < 3; index += 1) {
        const response = await step(server, explainBody(projectId, { byok: ANTHROPIC }), {
          key: OWN_KEY,
        });
        expect(response.status).toBe(200);
        await response.text();
      }
    });

    it('says when the provider refuses the key', async () => {
      const gateway = scripted({ kind: 'fail', failure: 'invalid-key', statusCode: 401 });
      const { server, projectId } = await serve({ ai: { gateway } });
      const response = await step(server, explainBody(projectId, { byok: ANTHROPIC }), {
        key: OWN_KEY,
      });
      expect(response.status).toBe(401);
      expect(await apiError(response)).toEqual({
        code: 'invalid-key',
        message: 'Anthropic refused your key. Check it in AI settings.',
      });
    });
  });

  describe('the shared tier', () => {
    it('counts down each visitor’s daily allowance, then suggests their own key', async () => {
      const { server, projectId } = await serve({
        ai: { limits: { global: 100, perIp: 2, perProject: 100 } },
      });
      const remaining = async (): Promise<unknown> =>
        (await events(await step(server, explainBody(projectId)))).at(-1);

      expect(await remaining()).toMatchObject({ type: 'finish', remainingToday: 1 });
      expect(await remaining()).toMatchObject({ type: 'finish', remainingToday: 0 });

      const refused = await step(server, explainBody(projectId));
      expect(refused.status).toBe(429);
      const error = await apiError(refused);
      expect(error.code).toBe('quota-exhausted');
      expect(error.message).toContain('add your own key');
    });

    it('is off, with a message saying so, when the server has no key', async () => {
      const gateway = createFakeModelGateway();
      const { server, projectId } = await serve({ ai: { gateway, sharedTier: null } });
      const response = await step(server, explainBody(projectId));
      expect(response.status).toBe(503);
      expect((await apiError(response)).message).toContain('Add your own key');
      expect(gateway.calls).toHaveLength(0);
    });

    it('explains a busy provider and suggests an own key', async () => {
      const gateway = scripted({ kind: 'fail', failure: 'rate-limited', statusCode: 429 });
      const { server, projectId } = await serve({ ai: { gateway } });
      const response = await step(server, explainBody(projectId));
      expect(response.status).toBe(429);
      expect(await apiError(response)).toEqual({
        code: 'rate-limited',
        message:
          'The shared free AI is busy right now. Try again in a minute, or add your own key in AI settings.',
      });
    });

    it('does not blame the caller when the provider refuses the server’s own key', async () => {
      const gateway = scripted({ kind: 'fail', failure: 'invalid-key', statusCode: 403 });
      const { server, projectId } = await serve({ ai: { gateway } });
      const response = await step(server, explainBody(projectId));
      expect(response.status).toBe(503);
      expect((await apiError(response)).code).toBe('unavailable');
    });
  });

  it('limits how often one visitor can call it per minute, own key or not', async () => {
    const { server, projectId } = await serve({ ai: { requestsPerMinute: 2 } });
    for (let index = 0; index < 2; index += 1) {
      await (await step(server, explainBody(projectId))).text();
    }
    const refused = await step(server, explainBody(projectId, { byok: ANTHROPIC }), {
      key: OWN_KEY,
    });
    expect(refused.status).toBe(429);
    expect((await apiError(refused)).code).toBe('rate-limited');
  });

  it('ends a stream that fails part way with an error event', async () => {
    const gateway = scripted({ kind: 'fail', failure: 'unavailable', afterChunks: ['Half an '] });
    const { server, projectId } = await serve({ ai: { gateway } });
    const response = await step(server, explainBody(projectId));
    expect(response.status).toBe(200);
    expect(await events(response)).toEqual([
      { type: 'text-delta', text: 'Half an ' },
      {
        type: 'error',
        error: {
          code: 'unavailable',
          message: 'The AI provider is not answering right now. Try again in a minute.',
        },
      },
    ]);
  });

  it('gives up on a model that takes too long', async () => {
    const gateway = scripted({ kind: 'text', chunks: ['late'], delayMs: 2_000 });
    const { server, projectId } = await serve({ ai: { gateway, callTimeoutMs: 100 } });
    const response = await step(server, explainBody(projectId));
    expect(response.status).toBe(503);
    expect((await apiError(response)).message).toContain('took too long');
  });

  it('stops the model call when the caller goes away mid-answer', async () => {
    const gateway = scripted({ kind: 'text', chunks: ['a', 'b', 'c', 'd'], delayMs: 150 });
    const { server, projectId } = await serve({ ai: { gateway } });
    const controller = new AbortController();

    const response = await step(server, explainBody(projectId), { signal: controller.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    controller.abort();

    await waitUntil(
      () => gateway.calls[0]?.signal.aborted === true,
      'the model call to be aborted after the caller left',
    );
  });

  it('lets browsers send the key header across origins', async () => {
    const { server } = await serve();
    const response = await fetch(`${server.httpUrl}${AI_STEP_PATH}`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': `content-type,${AI_KEY_HEADER}`,
      },
    });
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-headers')).toContain(AI_KEY_HEADER);
  });
});

describe('the rest of the API', () => {
  it('answers an oversized body with 413 rather than 500', async () => {
    const { server } = await serve();
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: 'blank-node', name: 'x'.repeat(20_000) }),
    });
    expect(response.status).toBe(413);
    expect((await apiError(response)).code).toBe('payload-too-large');
  });
});
