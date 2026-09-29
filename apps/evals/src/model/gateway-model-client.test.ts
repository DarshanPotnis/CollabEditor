import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ModelStepError,
  createFakeClock,
  createStopSource,
  type ModelStepRequest,
} from '@collabcode/agent';
import { ModelCallError } from '@collabcode/model-gateway';
import {
  AGENT_STEP_LIMITS,
  PROMPTS,
  type AssistantMessage,
  type ConversationEntry,
} from '@collabcode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Secret } from '../secrets/eval-key.js';
import { createFakeGateway, type FakeAnswer } from './fake-gateway.js';
import { createGatewayModelClient } from './gateway-model-client.js';
import { createPacer } from './pacer.js';
import { RequestLedger } from './request-ledger.js';

const KEY = 'eval-key-canary-client-3f9a';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const MESSAGE: AssistantMessage = {
  role: 'assistant',
  parts: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'list_files', input: {} }],
};

async function setup(
  answers: FakeAnswer[],
  options: { dailyLimit?: number; callTimeoutMs?: number } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'eval-ledger-'));
  dirs.push(dir);
  const clock = createFakeClock(Date.UTC(2026, 8, 29, 18));
  const ledger = await RequestLedger.open(join(dir, 'usage.json'), clock.now);
  const gateway = createFakeGateway(answers);
  const client = createGatewayModelClient({
    gateway,
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    key: new Secret(KEY),
    tier: 'shared',
    pacer: createPacer(100, clock),
    ledger,
    dailyLimit: options.dailyLimit ?? 100,
    ...(options.callTimeoutMs === undefined ? {} : { callTimeoutMs: options.callTimeoutMs }),
  });
  const request = (conversation: ConversationEntry[] = []): ModelStepRequest => ({
    inputs: { goal: 'Add a route', files: ['index.js'] },
    conversation,
    signal: createStopSource().signal,
    onText: () => undefined,
  });
  return { client, gateway, ledger, request };
}

/** `steps` model answers, each a list_files call and its result. */
function conversationOf(steps: number): ConversationEntry[] {
  return Array.from({ length: steps }, (_, index): ConversationEntry[] => [
    {
      role: 'assistant',
      parts: [
        { type: 'tool-call', toolCallId: `c${String(index)}`, toolName: 'list_files', input: {} },
      ],
    },
    {
      role: 'tool',
      results: [
        { toolCallId: `c${String(index)}`, toolName: 'list_files', isError: false, output: '' },
      ],
    },
  ]).flat();
}

async function stepError(promise: Promise<unknown>): Promise<ModelStepError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ModelStepError) return error;
    throw error;
  }
  throw new Error('expected the step to fail');
}

describe('the eval model client', () => {
  it("sends what the server sends: the agent prompt, its tools, and the tier's steps left", async () => {
    const { client, gateway, request } = await setup([{ kind: 'answer', message: MESSAGE }]);
    const conversation = conversationOf(12);
    const step = await client.step(request(conversation));

    const prepared = PROMPTS.agent.prepare({ goal: 'Add a route', files: ['index.js'] });
    if (!prepared.ok) throw new Error(prepared.message);
    const [call] = gateway.calls;
    expect(call).toMatchObject({
      target: { provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: KEY },
      system: prepared.prompt.system,
      messages: prepared.prompt.messages,
      maxOutputTokens: PROMPTS.agent.maxOutputTokens,
      toolUse: {
        use: PROMPTS.agent.toolUse,
        conversation,
        stepsLeft: AGENT_STEP_LIMITS.shared - 12,
      },
    });
    expect(step).toMatchObject({
      message: MESSAGE,
      model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
      prompt: { id: 'agent', version: PROMPTS.agent.version },
      remainingToday: null,
    });
    // The key goes to the provider and nowhere else the core can see.
    expect(JSON.stringify(step)).not.toContain(KEY);
  });

  it('turns a busy model and a rate limit before any answer into waits the core retries', async () => {
    const { client, request } = await setup([
      { kind: 'fail', error: new ModelCallError('unavailable', 503) },
      { kind: 'fail', error: new ModelCallError('rate-limited', 429) },
    ]);
    expect(await stepError(client.step(request()))).toMatchObject({ kind: 'busy', upFront: true });
    expect(await stepError(client.step(request()))).toMatchObject({
      kind: 'rate-limited',
      upFront: true,
    });
  });

  it('never retries a failure after the model began answering', async () => {
    const { client, request } = await setup([
      { kind: 'fail', error: new ModelCallError('unavailable', 503), afterText: 'Let me' },
    ]);
    const error = await stepError(client.step(request()));
    expect(error).toMatchObject({ kind: 'failed', upFront: false });
    expect(error.message).not.toContain(KEY);
  });

  it('gives up on a model that does not answer in time', async () => {
    const { client, request } = await setup([{ kind: 'hang' }], { callTimeoutMs: 50 });
    expect(await stepError(client.step(request()))).toMatchObject({
      kind: 'failed',
      message: 'The model did not answer within 0.05 s.',
    });
  });

  it('counts every request in the ledger, and stops at the daily limit without calling', async () => {
    const { client, gateway, ledger, request } = await setup(
      [
        { kind: 'fail', error: new ModelCallError('unavailable', 503) },
        { kind: 'answer', message: MESSAGE },
      ],
      { dailyLimit: 2 },
    );
    await stepError(client.step(request()));
    await client.step(request());
    expect(ledger.used('gemini-3.5-flash-lite')).toBe(2);
    const error = await stepError(client.step(request()));
    expect(error).toMatchObject({ kind: 'failed', upFront: true });
    expect(error.message).toMatch(/daily limit for gemini-3\.5-flash-lite is used up \(2 of 2/);
    expect(gateway.calls).toHaveLength(2);
  });

  it('refuses a conversation the server would refuse, without calling', async () => {
    const { client, gateway, request } = await setup([]);
    const error = await stepError(client.step(request([{ role: 'nudge' }])));
    expect(error.message).toBe('The conversation was refused: The conversation is out of order.');
    expect(gateway.calls).toHaveLength(0);
  });
});
