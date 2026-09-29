/**
 * The log canary (docs/PLAN-AI.md §6.1): a known key and a known piece of
 * project text go through every path the AI route has, success and failure,
 * and neither may appear in any log line.
 *
 * It uses the real logger configuration and the real AI SDK gateway, with mock
 * models that echo the canaries back the way a provider might: in an answer,
 * in an error body, in the request body an APICallError carries. The console
 * is watched too, since the SDK prints errors there unless told not to, and
 * the host keeps whatever the process prints.
 */
import { Writable } from 'node:stream';
import { format } from 'node:util';
import { AI_KEY_HEADER, AI_STEP_PATH } from '@collabcode/shared';
import { APICallError } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAiSdkGateway } from '@collabcode/model-gateway';
import type { ModelTarget } from '@collabcode/model-gateway';
import { startTestServer, type TestServer } from '../collab/test-server.js';
import { createLogger } from '../lib/logger.js';
import { seedProject } from '../test/support.js';

const CANARY_KEY = 'sk-canary-KEY-7f3a91c4';
const CANARY_TEXT = 'CANARY-PROJECT-TEXT-91bd';
const ORIGIN = 'http://localhost:5173';

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;

function echoingModel(): MockLanguageModelV4 {
  const chunks: StreamPart[] = [
    { type: 'stream-start', warnings: [{ type: 'other', message: `saw ${CANARY_TEXT}` }] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: `Your code ${CANARY_TEXT} logs a value.` },
    { type: 'text-end', id: 't' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'STOP' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
    },
  ];
  return new MockLanguageModelV4({
    doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
  });
}

function refusingModel(statusCode: number): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.reject(
        new APICallError({
          message: `Incorrect API key provided: ${CANARY_KEY}`,
          url: 'https://provider.example/v1/messages',
          requestBodyValues: { messages: [{ role: 'user', content: CANARY_TEXT }] },
          statusCode,
          responseBody: JSON.stringify({ error: `bad key ${CANARY_KEY} for ${CANARY_TEXT}` }),
          isRetryable: false,
        }),
      ),
  });
}

/** The model a request gets depends on the key it sent, so each path is reachable. */
function modelFor(target: ModelTarget): MockLanguageModelV4 {
  if (target.apiKey.endsWith('-refused')) return refusingModel(401);
  if (target.apiKey.endsWith('-broken')) return refusingModel(500);
  if (target.apiKey.endsWith('-throws')) throw new Error(`cannot build model for ${CANARY_KEY}`);
  return echoingModel();
}

const lines: string[] = [];
const printed: string[] = [];
let server: TestServer;
let projectId: string;

beforeAll(async () => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(format(...args));
    });
  }
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = createLogger('trace', false, destination);
  server = await startTestServer({
    logger,
    ai: { gateway: createAiSdkGateway({ logger, createModel: modelFor }) },
  });
  projectId = (await seedProject(server.repo)).id;
});

afterAll(async () => {
  await server.stop();
  vi.restoreAllMocks();
});

const inputs = {
  path: 'index.js',
  language: 'javascript',
  startLine: 1,
  selection: `console.log("${CANARY_TEXT}");`,
};
const byok = { provider: 'anthropic', model: 'claude-sonnet-5' };

/** An agent step whose conversation carries project text in a tool result. */
function agentStep(): unknown {
  return {
    projectId,
    promptId: 'agent',
    inputs: { goal: `Fix ${CANARY_TEXT}`, files: ['index.js'] },
    sessionId: 'canary-session',
    conversation: [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'read_file',
            input: { path: 'index.js' },
          },
        ],
      },
      {
        role: 'tool',
        results: [
          { toolCallId: 'c1', toolName: 'read_file', isError: false, output: `1| ${CANARY_TEXT}` },
        ],
      },
    ],
  };
}

async function send(body: unknown, key?: string): Promise<number> {
  const response = await fetch(`${server.httpUrl}${AI_STEP_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(key === undefined ? {} : { [AI_KEY_HEADER]: key }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  await response.text();
  return response.status;
}

describe('the log canary', () => {
  it('keeps the key and the project text out of every log line, on every path', async () => {
    const step = { projectId, promptId: 'explain-selection', inputs };

    // Shared tier, answered.
    expect(await send(step)).toBe(200);
    // Own key, answered.
    expect(await send({ ...step, byok }, CANARY_KEY)).toBe(200);
    // Own key, refused by the provider, whose error echoes the key and the prompt.
    expect(await send({ ...step, byok }, `${CANARY_KEY}-refused`)).toBe(401);
    // Own key, provider failing on its side.
    expect(await send({ ...step, byok }, `${CANARY_KEY}-broken`)).toBe(503);
    // Own key, the model cannot even be built.
    expect(await send({ ...step, byok }, `${CANARY_KEY}-throws`)).toBe(503);
    // Inputs the prompt refuses, with the key attached.
    expect(
      await send(
        { ...step, byok, inputs: { ...inputs, selection: CANARY_TEXT.repeat(1_000) } },
        CANARY_KEY,
      ),
    ).toBe(400);
    // A key without its provider.
    expect(await send(step, CANARY_KEY)).toBe(400);
    // Malformed JSON that contains both.
    expect(await send(`{"inputs":"${CANARY_TEXT}", ${CANARY_KEY}`, CANARY_KEY)).toBe(400);
    // A body over the limit.
    expect(await send({ ...step, padding: CANARY_TEXT.repeat(30_000) }, CANARY_KEY)).toBe(413);
    // An agent step with its conversation: answered, then refused by the provider.
    expect(await send({ ...(agentStep() as object), byok }, CANARY_KEY)).toBe(200);
    expect(await send({ ...(agentStep() as object), byok }, `${CANARY_KEY}-refused`)).toBe(401);
    // An agent step whose conversation is refused.
    expect(
      await send(
        { ...(agentStep() as object), byok, conversation: [{ role: 'tool' }] },
        CANARY_KEY,
      ),
    ).toBe(400);

    const log = lines.join('');
    expect(log).not.toContain(CANARY_KEY);
    expect(log).not.toContain(CANARY_TEXT);
    const console = printed.join('\n');
    expect(console).not.toContain(CANARY_KEY);
    expect(console).not.toContain(CANARY_TEXT);

    // Not vacuous: the requests were logged, with their metadata.
    const stepLines = lines.filter((line) => line.includes('"msg":"ai step'));
    expect(stepLines).toHaveLength(7);
    expect(stepLines[0]).toContain('"promptId":"explain-selection"');
    expect(stepLines[0]).toContain('"provider":"gemini"');
    // pino-http logs each request once, as completed or (for a 5xx) errored.
    expect(lines.filter((line) => /"msg":"request (completed|errored)"/.test(line))).toHaveLength(
      12,
    );
  });
});
