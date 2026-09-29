/**
 * The AI route through the real Hocuspocus mount and middleware, with a
 * scripted gateway in place of a model.
 */
import { AI_KEY_HEADER, AI_STEP_PATH, PROMPTS } from '@collabcode/shared';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startTestServer,
  type StartTestServerOptions,
  type TestServer,
} from '../collab/test-server.js';
import { createLogger } from '../lib/logger.js';
import { ORIGIN, apiError, events, step } from '../test/ai-requests.js';
import { createFakeModelGateway, type FakeReply } from '../test/fake-model-gateway.js';
import { seedProject, waitUntil } from '../test/support.js';

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
        rawFinishReason: null,
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
      const response = await step(server, explainBody(projectId, { padding: 'x'.repeat(600_000) }));
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

    it('slows everyone down past its per-minute limit, saying how long to wait', async () => {
      let current = Date.parse('2026-09-27T19:00:00Z');
      const { server, projectId } = await serve({
        ai: {
          sharedTierPerMinute: 2,
          limits: { global: 100, perIp: 3, perProject: 100 },
          now: () => current,
        },
      });
      await events(await step(server, explainBody(projectId)));
      current += 20_000;
      await events(await step(server, explainBody(projectId)));

      const busy = await step(server, explainBody(projectId));
      expect(busy.status).toBe(429);
      expect(busy.headers.get('retry-after')).toBe('40');
      expect(await apiError(busy)).toEqual({
        code: 'rate-limited',
        message:
          'The shared free AI is busy right now. Try again in about 40 seconds, or add your own key in AI settings.',
      });

      // The first request's slot opens a minute after it started. The busy
      // refusal never counted against the day: this is the third of three.
      current += 40_000;
      const after = await events(await step(server, explainBody(projectId)));
      expect(after.at(-1)).toMatchObject({ type: 'finish', remainingToday: 0 });
    });

    it('does not let a request the daily allowances refuse use up a minute slot', async () => {
      const { server, projectId } = await serve({
        ai: { sharedTierPerMinute: 2, limits: { global: 100, perIp: 100, perProject: 1 } },
      });
      const { id: otherProjectId } = await seedProject(server.repo);
      await events(await step(server, explainBody(projectId)));
      expect((await apiError(await step(server, explainBody(projectId)))).code).toBe(
        'quota-exhausted',
      );
      expect((await step(server, explainBody(otherProjectId))).status).toBe(200);
    });

    it('does not hold requests with an own key to its per-minute limit', async () => {
      const { server, projectId } = await serve({ ai: { sharedTierPerMinute: 0 } });
      expect((await step(server, explainBody(projectId))).status).toBe(429);
      const own = await step(server, explainBody(projectId, { byok: ANTHROPIC }), { key: OWN_KEY });
      expect(own.status).toBe(200);
      await own.text();
    });

    it('gives the day’s request back when the provider refuses it for rate or quota up front', async () => {
      let reply: FakeReply = { kind: 'fail', failure: 'rate-limited', statusCode: 429 };
      const gateway = createFakeModelGateway(() => reply);
      const { server, projectId } = await serve({
        ai: { gateway, limits: { global: 100, perIp: 1, perProject: 100 } },
      });
      const refused = await step(server, explainBody(projectId));
      expect(refused.status).toBe(429);
      await refused.text();

      reply = { kind: 'text', chunks: ['Fine now.'] };
      const retried = await step(server, explainBody(projectId));
      expect(retried.status).toBe(200);
      expect((await events(retried)).at(-1)).toMatchObject({ type: 'finish', remainingToday: 0 });
    });

    it.each<[string, FakeReply]>([
      ['for another reason', { kind: 'fail', failure: 'unavailable', statusCode: 500 }],
      [
        'after it began answering',
        { kind: 'fail', failure: 'rate-limited', statusCode: 429, afterChunks: ['Half'] },
      ],
    ])('keeps counting a request the provider failed %s', async (_label, reply) => {
      const { server, projectId } = await serve({
        ai: { gateway: scripted(reply), limits: { global: 100, perIp: 1, perProject: 100 } },
      });
      await (await step(server, explainBody(projectId))).text();
      const next = await step(server, explainBody(projectId));
      expect(next.status).toBe(429);
      expect((await apiError(next)).code).toBe('quota-exhausted');
    });

    it('gives the day’s request back when the model is busy before answering, and says so', async () => {
      let reply: FakeReply = { kind: 'fail', failure: 'unavailable', statusCode: 503 };
      const gateway = createFakeModelGateway(() => reply);
      const { server, projectId } = await serve({
        ai: { gateway, limits: { global: 100, perIp: 1, perProject: 100 } },
      });
      const busy = await step(server, explainBody(projectId));
      expect(busy.status).toBe(503);
      expect(await apiError(busy)).toEqual({
        code: 'busy',
        message:
          'The shared free AI model is busy right now. Try again in a minute, or add your own key in AI settings.',
      });

      reply = { kind: 'text', chunks: ['Fine now.'] };
      const retried = await step(server, explainBody(projectId));
      expect((await events(retried)).at(-1)).toMatchObject({ type: 'finish', remainingToday: 0 });
    });

    describe('with a fallback model', () => {
      const sharedTier = {
        model: 'gemini-3.5-flash-lite',
        fallbackModel: 'gemini-3.1-flash-lite',
        apiKey: 'shared-test-key',
      };

      function busyDefault(fallback: FakeReply = { kind: 'text', chunks: ['From the fallback.'] }) {
        return createFakeModelGateway((call) =>
          call.target.model === sharedTier.model
            ? { kind: 'fail', failure: 'unavailable', statusCode: 503 }
            : fallback,
        );
      }

      it('answers from the fallback when the default is busy, counting one request', async () => {
        const gateway = busyDefault();
        const { server, projectId } = await serve({
          ai: { gateway, sharedTier, limits: { global: 100, perIp: 5, perProject: 100 } },
        });
        const received = await events(await step(server, explainBody(projectId)));
        expect(gateway.calls.map((call) => call.target.model)).toEqual([
          'gemini-3.5-flash-lite',
          'gemini-3.1-flash-lite',
        ]);
        expect(received.at(-1)).toMatchObject({
          type: 'finish',
          model: { provider: 'gemini', id: 'gemini-3.1-flash-lite' },
          remainingToday: 4,
        });
      });

      it('does not try it for any other failure', async () => {
        const gateway = createFakeModelGateway(() => ({
          kind: 'fail',
          failure: 'rate-limited',
          statusCode: 429,
        }));
        const { server, projectId } = await serve({ ai: { gateway, sharedTier } });
        expect((await step(server, explainBody(projectId))).status).toBe(429);
        expect(gateway.calls).toHaveLength(1);
      });

      it('says busy and gives the request back when both are busy', async () => {
        const gateway = busyDefault({ kind: 'fail', failure: 'unavailable', statusCode: 503 });
        const { server, projectId } = await serve({
          ai: { gateway, sharedTier, limits: { global: 100, perIp: 1, perProject: 100 } },
        });
        expect((await apiError(await step(server, explainBody(projectId)))).code).toBe('busy');
        expect(gateway.calls).toHaveLength(2);
        const next = await step(server, explainBody(projectId));
        expect(next.status).toBe(503);
        expect(gateway.calls).toHaveLength(4);
      });

      it('is never used with an own key', async () => {
        const gateway = busyDefault();
        const { server, projectId } = await serve({ ai: { gateway, sharedTier } });
        const response = await step(server, explainBody(projectId, { byok: ANTHROPIC }), {
          key: OWN_KEY,
        });
        await response.text();
        expect(gateway.calls.map((call) => call.target.model)).toEqual(['claude-sonnet-5']);
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

  function capturingLogger(): { logger: ReturnType<typeof createLogger>; timedOut: () => unknown } {
    const lines: string[] = [];
    const logger = createLogger(
      'info',
      false,
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
    );
    const timedOut = (): unknown =>
      lines
        .map((line) => JSON.parse(line) as { level: number; msg: string; ai?: unknown })
        .find((entry) => entry.msg === 'ai step timed out');
    return { logger, timedOut };
  }

  it('says a model that never starts answering is busy, and logs it as a warning', async () => {
    const { logger, timedOut } = capturingLogger();
    const gateway = scripted({ kind: 'text', chunks: ['late'], delayMs: 2_000 });
    const { server, projectId } = await serve({ logger, ai: { gateway, callTimeoutMs: 100 } });
    const response = await step(server, explainBody(projectId));
    expect(response.status).toBe(503);
    const error = await apiError(response);
    expect(error.code).toBe('busy');
    expect(error.message).toContain('did not start answering in time, so it is probably busy');
    expect(timedOut()).toMatchObject({
      level: 40,
      ai: { failure: 'no-answer', firstEventMs: null },
    });
  });

  it('gives up on a model that stops part way, and says it took too long', async () => {
    const { logger, timedOut } = capturingLogger();
    const gateway = scripted({ kind: 'text', chunks: ['Half', ' done'], delayMs: 300 });
    const { server, projectId } = await serve({ logger, ai: { gateway, callTimeoutMs: 450 } });
    const response = await step(server, explainBody(projectId));
    expect(response.status).toBe(200);
    const received = await events(response);
    expect(received[0]).toEqual({ type: 'text-delta', text: 'Half' });
    expect(received.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'unavailable', message: expect.stringContaining('took too long') as string },
    });
    expect(timedOut()).toMatchObject({ ai: { failure: 'timeout' } });
  });

  it('never calls a failure that came before the time limit a timeout', async () => {
    const gateway = scripted({ kind: 'fail', failure: 'unavailable', statusCode: 500 });
    const { server, projectId } = await serve({ ai: { gateway, callTimeoutMs: 5_000 } });
    const response = await step(server, explainBody(projectId));
    expect(response.status).toBe(503);
    expect((await apiError(response)).message).toBe(
      'The AI provider is not answering right now. Try again in a minute.',
    );
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
