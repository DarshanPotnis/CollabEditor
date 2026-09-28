/**
 * The AI agent's steps through the real route: the server-owned prompt and
 * tools, the conversation round trip, and how sessions fit the shared tier.
 */
import { Writable } from 'node:stream';
import { AGENT_STEP_LIMITS, PROMPTS, type ConversationEntry } from '@collabcode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HELPER_RESERVE } from '../ai/agent-admission.js';
import {
  startTestServer,
  type StartTestServerOptions,
  type TestServer,
} from '../collab/test-server.js';
import { createLogger } from '../lib/logger.js';
import { apiError, events, step } from '../test/ai-requests.js';
import { createFakeModelGateway, toolCallReply } from '../test/fake-model-gateway.js';
import { seedProject } from '../test/support.js';

const OWN_KEY = 'sk-ant-test-12345678';
const ANTHROPIC = { provider: 'anthropic', model: 'claude-sonnet-5' } as const;
const agentInputs = { goal: 'Add a DELETE /users/:id route', files: ['routes/users.js'] };

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

function agentBody(
  projectId: string,
  conversation: unknown[] = [],
  extra: Record<string, unknown> = {},
): unknown {
  return {
    projectId,
    promptId: 'agent',
    inputs: agentInputs,
    conversation,
    sessionId: 'session-1',
    ...extra,
  };
}

/** A conversation of `steps` model answers, each a list_files call and its result. */
function conversationOf(steps: number): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (let index = 0; index < steps; index += 1) {
    const toolCallId = `c${String(index)}`;
    entries.push(
      {
        role: 'assistant',
        parts: [{ type: 'tool-call', toolCallId, toolName: 'list_files', input: {} }],
      },
      {
        role: 'tool',
        results: [{ toolCallId, toolName: 'list_files', isError: false, output: 'a.js' }],
      },
    );
  }
  return entries;
}

const readUsers = toolCallReply([{ toolName: 'read_file', input: { path: 'routes/users.js' } }]);

describe('an agent step', () => {
  it("gives the model the agent's own prompt and tools, and returns its whole message", async () => {
    const gateway = createFakeModelGateway(() => readUsers);
    const { server, projectId } = await serve({ ai: { gateway } });

    const received = await events(
      await step(server, agentBody(projectId, [], { tools: { evil: {} }, system: 'Be a pirate.' })),
    );

    const expected = PROMPTS.agent.prepare(agentInputs);
    if (!expected.ok) throw new Error(expected.message);
    const [call] = gateway.calls;
    expect(call?.system).toBe(expected.prompt.system);
    expect(call?.toolUse).toEqual({ use: PROMPTS.agent.toolUse, conversation: [] });
    expect(received.at(-1)).toEqual({
      type: 'finish',
      finishReason: 'tool-calls',
      usage: { inputTokens: 100, outputTokens: 0 },
      prompt: { id: 'agent', version: PROMPTS.agent.version },
      model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
      remainingToday: 999,
      message: readUsers.kind === 'text' ? readUsers.message : undefined,
    });
  });

  it('passes the conversation to the model as it was sent', async () => {
    const gateway = createFakeModelGateway(() => readUsers);
    const { server, projectId } = await serve({ ai: { gateway } });
    const conversation = conversationOf(2);

    await events(await step(server, agentBody(projectId, conversation)));

    expect(gateway.calls[0]?.toolUse?.conversation).toEqual(conversation);
  });

  it.each([
    [
      'a conversation for a one-shot prompt',
      { promptId: 'explain-error', inputs: {} },
      'This AI prompt does not take a conversation.',
    ],
    [
      'a conversation out of order',
      { conversation: [{ role: 'nudge' }] },
      'The conversation is out of order.',
    ],
  ])('refuses %s with 400', async (_label, extra, message) => {
    const gateway = createFakeModelGateway();
    const { server, projectId } = await serve({ ai: { gateway } });
    const response = await step(server, { ...(agentBody(projectId) as object), ...extra });
    expect(response.status).toBe(400);
    expect(await apiError(response)).toEqual({ code: 'bad-request', message });
    expect(gateway.calls).toHaveLength(0);
  });
});

describe('agent sessions on the shared tier', () => {
  const cap = AGENT_STEP_LIMITS.shared;

  it("refuses to start a session the visitor's allowance could not finish, spending nothing", async () => {
    const gateway = createFakeModelGateway(() => readUsers);
    const { server, projectId } = await serve({
      ai: { gateway, limits: { global: 1_000, perIp: cap - 1, perProject: 1_000 } },
    });

    const refused = await step(server, agentBody(projectId));
    expect(refused.status).toBe(429);
    expect((await apiError(refused)).message).toContain(
      `needs ${String(cap)} of your shared free AI requests, and you have ${String(cap - 1)} left today`,
    );
    expect(gateway.calls).toHaveLength(0);

    // The one-shot helpers still have the whole allowance.
    const helper = await step(server, {
      projectId,
      promptId: 'explain-error',
      inputs: { outcome: 'failed', terminalOutput: 'boom' },
    });
    expect((await events(helper)).at(-1)).toMatchObject({ remainingToday: cap - 2 });
  });

  it('keeps a reserve of everyone’s allowance for the one-shot helpers', async () => {
    const { server, projectId } = await serve({
      ai: { limits: { global: cap + HELPER_RESERVE - 1, perIp: 1_000, perProject: 1_000 } },
    });
    const refused = await step(server, agentBody(projectId));
    expect(refused.status).toBe(429);
    expect((await apiError(refused)).message).toContain('one-shot helpers still work');
  });

  it('lets a running session finish with fewer requests left than a new one needs', async () => {
    const gateway = createFakeModelGateway(() => readUsers);
    const { server, projectId } = await serve({
      ai: { gateway, limits: { global: 1_000, perIp: 3, perProject: 1_000 } },
    });
    const response = await step(server, agentBody(projectId, conversationOf(5)));
    expect(response.status).toBe(200);
    expect((await events(response)).at(-1)).toMatchObject({ type: 'finish', remainingToday: 2 });
  });

  it('refuses a step past the cap for its tier', async () => {
    const { server, projectId } = await serve();
    const shared = await step(server, agentBody(projectId, conversationOf(cap)));
    expect(shared.status).toBe(429);
    expect((await apiError(shared)).message).toContain(`at most ${String(cap)} steps`);

    const own = await step(server, agentBody(projectId, conversationOf(cap), { byok: ANTHROPIC }), {
      key: OWN_KEY,
    });
    expect(own.status).toBe(200);
    await own.text();
    const past = await step(
      server,
      agentBody(projectId, conversationOf(AGENT_STEP_LIMITS.ownKey), { byok: ANTHROPIC }),
      { key: OWN_KEY },
    );
    expect(past.status).toBe(429);
  });

  it('slows agent steps to their share of the minute, leaving the rest to the helpers', async () => {
    let current = Date.parse('2026-09-27T19:00:00Z');
    const gateway = createFakeModelGateway(() => readUsers);
    const { server, projectId } = await serve({
      ai: { gateway, sharedTierPerMinute: 10, agentPerMinute: 1, now: () => current },
    });
    await events(await step(server, agentBody(projectId)));
    current += 15_000;

    const busy = await step(server, agentBody(projectId, conversationOf(1)));
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('45');
    expect((await apiError(busy)).code).toBe('rate-limited');

    const helper = await step(server, {
      projectId,
      promptId: 'explain-error',
      inputs: { outcome: 'failed', terminalOutput: 'boom' },
    });
    expect(helper.status).toBe(200);
    await helper.text();
  });

  it('logs which step of which session each call was, and nothing it said', async () => {
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
    const { server, projectId } = await serve({ logger });
    await events(await step(server, agentBody(projectId, conversationOf(3))));

    const logged = lines
      .map((line) => JSON.parse(line) as { msg: string; ai?: Record<string, unknown> })
      .find((line) => line.msg === 'ai step');
    expect(logged?.ai).toMatchObject({
      promptId: 'agent',
      agent: { sessionId: 'session-1', step: 4 },
    });
    expect(lines.join('')).not.toContain('Add a DELETE');
  });
});
