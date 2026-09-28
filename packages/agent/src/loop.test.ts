import { toolCallsOf, type ConversationEntry } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from './events.js';
import { createFakeClock } from './fake-clock.js';
import { AGENT_LIMITS, type AgentLimits } from './limits.js';
import { runAgent, type AgentRunOptions } from './loop.js';
import { answerWith, createScriptedModel, toolCall, type ScriptEntry } from './scripted-model.js';
import { createStopSource } from './stop-source.js';
import { drive, recordingHost, untilStopped, type RecordingHost } from './test/support.js';
import { ModelStepError, type ToolHost } from './types.js';

const inputs = { goal: 'Add a DELETE /users/:id route', files: ['routes/users.js'] };

const finish = (summary = 'Added the route and checked it.') =>
  answerWith([toolCall('finish', { summary })]);

type SessionOptions = { tools?: ToolHost; limits?: AgentLimits } & Partial<AgentRunOptions>;

function session(script: readonly ScriptEntry[], options: SessionOptions = {}) {
  const clock = createFakeClock(1_000);
  const model = createScriptedModel(script);
  const tools = options.tools ?? recordingHost();
  const stop = createStopSource();
  const events: AgentEvent[] = [];
  const run = runAgent({
    sessionId: 'session-1',
    inputs,
    tier: 'shared',
    model,
    tools,
    clock,
    stop: stop.signal,
    project: { template: 'express-api', filesFingerprint: 'f1' },
    onEvent: (event) => events.push(event),
    random: () => 0.5,
    ...options,
  });
  return { clock, model, tools, stop, events, run, result: () => drive(clock, run) };
}

function hostOf(tools: ToolHost): RecordingHost {
  return tools as RecordingHost;
}

describe('a session', () => {
  it('reads, edits and finishes, carrying out each call through the ToolHost', async () => {
    const { result, tools, events } = session([
      answerWith([toolCall('read_file', { path: 'routes/users.js' })], 'Let me look.'),
      answerWith([toolCall('edit_file', { path: 'routes/users.js', oldText: 'a', newText: 'b' })]),
      finish(),
    ]);
    const { outcome, conversation, trace } = await result();

    expect(outcome).toEqual({ kind: 'finished', summary: 'Added the route and checked it.' });
    expect(hostOf(tools).calls).toEqual([
      { name: 'read_file', input: { path: 'routes/users.js' } },
      { name: 'edit_file', input: { path: 'routes/users.js', oldText: 'a', newText: 'b' } },
    ]);
    expect(conversation.map((entry) => entry.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(trace.totals.steps).toBe(3);
    expect(events.map((event) => event.type)).toEqual([
      'step-started',
      'text',
      'model-answered',
      'tool-started',
      'tool-finished',
      'step-started',
      'model-answered',
      'tool-started',
      'tool-finished',
      'step-started',
      'model-answered',
      'tool-started',
      'finished',
    ]);
  });

  it("sends the model's messages back exactly as they came, providerOptions included", async () => {
    const signed = toolCall('list_files', {});
    const first = answerWith([
      { ...signed, providerOptions: { google: { thoughtSignature: 'sig' } } },
    ]);
    const { result, model } = session([first, finish()]);
    await result();

    const [, second] = model.requests;
    expect(second?.conversation[0]).toBe(first.message);
    expect(second?.conversation[1]).toEqual({
      role: 'tool',
      results: [
        {
          toolCallId: signed.toolCallId,
          toolName: 'list_files',
          isError: false,
          output: 'list_files done',
        },
      ],
    });
  });

  it('gives the model the goal and file list on every step', async () => {
    const { result, model } = session([answerWith([toolCall('list_files', {})]), finish()]);
    await result();
    expect(model.requests.map((request) => request.inputs)).toEqual([inputs, inputs]);
  });
});

describe('limits', () => {
  const tight = (overrides: Partial<AgentLimits>): AgentLimits => ({
    ...AGENT_LIMITS.shared,
    ...overrides,
  });

  it('stops after the step limit when the model never finishes', async () => {
    const script = Array.from({ length: 5 }, () => answerWith([toolCall('list_files', {})]));
    const { result, model } = session(script, { limits: tight({ maxSteps: 3 }) });
    const { outcome } = await result();
    expect(outcome).toEqual({
      kind: 'limit',
      limit: 'steps',
      message: 'The session used all 3 steps without finishing.',
    });
    expect(model.requests).toHaveLength(3);
  });

  it('ends by saying what it changed, for a panel with no summary to show', async () => {
    const script = [
      answerWith([toolCall('edit_file', { path: 'routes/users.js', oldText: 'a', newText: 'b' })]),
      answerWith([toolCall('create_file', { path: 'scratch.js', content: '' })]),
      answerWith([toolCall('delete_file', { path: 'scratch.js' })]),
    ];
    const { result, events } = session(script, { limits: tight({ maxSteps: 3 }) });
    await result();
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      outcome: { kind: 'limit', limit: 'steps' },
      changes: { created: [], edited: ['routes/users.js'], renamed: [], deleted: [] },
    });
  });

  it('stops at the time limit, stopping the tool that is running', async () => {
    const tools = recordingHost((_call, signal) => untilStopped(signal));
    const { result } = session([answerWith([toolCall('run_project', {})])], { tools });
    const { outcome, trace } = await result();
    expect(outcome).toEqual({
      kind: 'limit',
      limit: 'time',
      message: 'The session reached its time limit of 5 minutes.',
    });
    expect(tools.signals[0]?.aborted).toBe(true);
    expect(trace.totals.durationMs).toBe(5 * 60_000);
  });

  it('stops once the input tokens are used up', async () => {
    const heavy = {
      ...answerWith([toolCall('list_files', {})]),
      usage: { inputTokens: 250_000, outputTokens: 10 },
    };
    const { result, model } = session([heavy, heavy, heavy]);
    const { outcome } = await result();
    expect(outcome).toMatchObject({ kind: 'limit', limit: 'tokens' });
    expect(model.requests).toHaveLength(2);
  });

  it('estimates tokens when the provider reports none', async () => {
    const unmetered = {
      ...answerWith([toolCall('list_files', {})]),
      usage: { inputTokens: null, outputTokens: null },
    };
    const { result } = session([unmetered, finish()]);
    const { trace } = await result();
    expect(trace.totals.inputTokens).toBeGreaterThan(0);
  });

  it('carries out at most eight calls from one answer and answers the rest as skipped', async () => {
    const calls = Array.from({ length: 10 }, (_, index) =>
      toolCall('read_file', { path: `f${String(index)}.js` }),
    );
    const { result, tools } = session([answerWith(calls), finish()]);
    const { conversation } = await result();
    expect(hostOf(tools).calls).toHaveLength(8);
    const results = conversation[1]?.role === 'tool' ? conversation[1].results : [];
    expect(results).toHaveLength(10);
    expect(
      results.slice(8).every((entry) => entry.isError && entry.output.startsWith('Skipped')),
    ).toBe(true);
  });
});

describe('Stop', () => {
  it('ends the session while the model is answering', async () => {
    const { run, stop, model } = session([() => new Promise(() => undefined)]);
    await new Promise((resolve) => setImmediate(resolve));
    stop.stop();
    const { outcome } = await run;
    expect(outcome).toEqual({ kind: 'stopped' });
    expect(model.requests[0]?.signal.aborted).toBe(true);
  });

  it('ends the session while a tool runs, and tells the tool', async () => {
    const tools = recordingHost((_call, signal) => untilStopped(signal));
    const { run, stop } = session(
      [answerWith([toolCall('run_project', {}), toolCall('list_files', {})])],
      {
        tools,
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    stop.stop();
    const { outcome } = await run;
    expect(outcome).toEqual({ kind: 'stopped' });
    expect(tools.calls.map((call) => call.name)).toEqual(['run_project']);
    expect(tools.signals[0]?.aborted).toBe(true);
  });

  it('never calls the model when stopped before it starts', async () => {
    const stop = createStopSource();
    stop.stop();
    const { run, model } = session([finish()], { stop: stop.signal });
    expect((await run).outcome).toEqual({ kind: 'stopped' });
    expect(model.requests).toHaveLength(0);
  });
});

describe('tool errors', () => {
  it('passes a refused call back to the model and carries on', async () => {
    const tools = recordingHost(() => ({ ok: false, output: 'No file called nope.js.' }));
    const { result, model } = session(
      [answerWith([toolCall('read_file', { path: 'nope.js' })]), finish()],
      {
        tools,
      },
    );
    const { outcome } = await result();
    expect(outcome.kind).toBe('finished');
    const answered = model.requests[1]?.conversation[1];
    expect(answered).toMatchObject({
      role: 'tool',
      results: [{ isError: true, output: 'No file called nope.js.' }],
    });
  });

  it('answers a call whose ToolHost threw as failed, reports the crash, and carries on', async () => {
    const tools = recordingHost(() => {
      throw new Error('bug in the host');
    });
    const { result, events } = session([answerWith([toolCall('list_files', {})]), finish()], {
      tools,
    });
    const { outcome, conversation } = await result();
    expect(outcome.kind).toBe('finished');
    expect(conversation[1]).toMatchObject({
      results: [{ isError: true, output: 'list_files failed unexpectedly. Try another way.' }],
    });
    expect(events).toContainEqual({
      type: 'crashed',
      where: 'tool',
      error: new Error('bug in the host'),
    });
  });
});

describe('malformed model output', () => {
  it('explains an unknown tool and invalid input so the model can correct itself', async () => {
    const { result, tools } = session([
      answerWith([toolCall('delete_everything', {}), toolCall('read_file', { file: 'a.js' })]),
      finish(),
    ]);
    const { conversation, outcome } = await result();
    expect(outcome.kind).toBe('finished');
    expect(hostOf(tools).calls).toHaveLength(0);
    const results = conversation[1]?.role === 'tool' ? conversation[1].results : [];
    expect(results[0]?.output).toMatch(
      /^There is no tool named "delete_everything"\. The tools are: list_files, /,
    );
    expect(results[1]?.output).toMatch(/^The input for read_file is not valid: path: /);
  });

  it('carries out the calls of an answer that ended for an "other" reason', async () => {
    // Gemini's stream can end without a finish reason; the provider then says "other".
    const other = { ...answerWith([toolCall('list_files', {})]), finishReason: 'other' as const };
    const { result, tools } = session([other, finish()]);
    expect((await result()).outcome.kind).toBe('finished');
    expect(hostOf(tools).calls).toEqual([{ name: 'list_files', input: {} }]);
  });

  it('says an invalid call may have been cut off at the output limit', async () => {
    const cutOff = {
      ...answerWith([toolCall('edit_file', { path: 'a.js' })]),
      finishReason: 'length' as const,
    };
    const { result } = session([cutOff, finish()]);
    const { conversation } = await result();
    expect(conversation[1]).toMatchObject({
      results: [{ output: expect.stringContaining('cut off at the output limit') as string }],
    });
  });

  it('gives up after three answers in a row whose calls could not be carried out', async () => {
    const bad = answerWith([toolCall('read_file', {})]);
    const good = answerWith([toolCall('list_files', {})]);
    const { result, model } = session([bad, bad, good, bad, bad, bad, finish()]);
    const { outcome } = await result();
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'invalid-calls' });
    expect(model.requests).toHaveLength(6);
  });

  it('asks for a summary when finish comes without one', async () => {
    const { result } = session([
      answerWith([toolCall('finish', { summary: ' ' })]),
      finish('Done.'),
    ]);
    const { outcome, conversation } = await result();
    expect(outcome).toEqual({ kind: 'finished', summary: 'Done.' });
    expect(conversation[1]).toMatchObject({ results: [{ isError: true, toolName: 'finish' }] });
  });

  it('nudges once after an answer without a tool call, then gives up on a second', async () => {
    const chatty = {
      message: { role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'Hmm.' }] },
    };
    const { result, model } = session([
      chatty,
      answerWith([toolCall('list_files', {})]),
      chatty,
      chatty,
    ]);
    const { outcome } = await result();
    expect(model.requests[1]?.conversation.at(-1)).toEqual({ role: 'nudge' });
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'no-tool-call' });
    expect(model.requests).toHaveLength(4);
  });

  it('carries out the calls before finish, and none after it', async () => {
    const { result, tools } = session([
      answerWith([
        toolCall('edit_file', { path: 'a.js', oldText: 'a', newText: 'b' }),
        toolCall('finish', { summary: 'Edited a.js.' }),
        toolCall('delete_file', { path: 'a.js' }),
      ]),
    ]);
    const { outcome } = await result();
    expect(outcome).toEqual({ kind: 'finished', summary: 'Edited a.js.' });
    expect(hostOf(tools).calls.map((call) => call.name)).toEqual(['edit_file']);
  });
});

describe('a busy or rate-limited model', () => {
  const busy = () => ({
    error: new ModelStepError('busy', 'The model is busy.', { upFront: true }),
  });

  it('retries a busy model twice, after about 5 and 15 seconds, and says so', async () => {
    const { result, events, model } = session([
      busy(),
      busy(),
      answerWith([toolCall('list_files', {})]),
      finish(),
    ]);
    const { outcome, trace } = await result();
    expect(outcome.kind).toBe('finished');
    expect(events.filter((event) => event.type === 'waiting')).toEqual([
      { type: 'waiting', step: 1, reason: 'busy', waitMs: 5_000 },
      { type: 'waiting', step: 1, reason: 'busy', waitMs: 15_000 },
    ]);
    expect(trace.steps[0]?.waits).toHaveLength(2);
    expect(model.requests).toHaveLength(4);
  });

  it('adds jitter to the waits', async () => {
    const { result, events } = session([busy(), finish()], { random: () => 0 });
    await result();
    expect(events.find((event) => event.type === 'waiting')).toMatchObject({ waitMs: 4_000 });
  });

  it('gives up after the second retry with the busy message', async () => {
    const { result } = session([busy(), busy(), busy(), finish()]);
    expect((await result()).outcome).toEqual({
      kind: 'failed',
      reason: 'model',
      message: 'The model is busy.',
    });
  });

  it('never retries a model that failed after it began answering', async () => {
    const { result, model } = session([
      { error: new ModelStepError('busy', 'Busy part way.', { upFront: false }) },
      finish(),
    ]);
    expect((await result()).outcome).toMatchObject({ kind: 'failed', message: 'Busy part way.' });
    expect(model.requests).toHaveLength(1);
  });

  it('waits out a per-minute limit for as long as it says', async () => {
    const { result, events } = session([
      {
        error: new ModelStepError('rate-limited', 'Too many.', {
          upFront: true,
          retryAfterMs: 45_000,
        }),
      },
      finish(),
    ]);
    expect((await result()).outcome.kind).toBe('finished');
    expect(events.find((event) => event.type === 'waiting')).toEqual({
      type: 'waiting',
      step: 1,
      reason: 'rate-limited',
      waitMs: 45_500,
    });
  });

  it('does not wait past the time limit', async () => {
    const { result, model } = session([
      {
        error: new ModelStepError('rate-limited', 'Too many.', {
          upFront: true,
          retryAfterMs: 400_000,
        }),
      },
      finish(),
    ]);
    expect((await result()).outcome).toMatchObject({ kind: 'failed', message: 'Too many.' });
    expect(model.requests).toHaveLength(1);
  });

  it('does not retry other failures, such as a used-up allowance', async () => {
    const { result, model } = session([
      { error: new ModelStepError('failed', 'No requests left today.', { upFront: true }) },
      finish(),
    ]);
    expect((await result()).outcome).toMatchObject({ message: 'No requests left today.' });
    expect(model.requests).toHaveLength(1);
  });
});

describe('the conversation size', () => {
  const big = 'x'.repeat(11_000);

  it('removes the oldest tool output to fit, never the model’s own messages', async () => {
    const tools = recordingHost(() => ({ ok: true, output: big }));
    const script = Array.from({ length: 13 }, () => answerWith([toolCall('list_files', {})]));
    const { result, model } = session([...script, finish()], {
      tools,
      limits: { ...AGENT_LIMITS.shared, maxSteps: 20 },
    });
    await result();

    const last = model.requests.at(-1)?.conversation ?? [];
    const outputs = last.flatMap((entry: ConversationEntry) =>
      entry.role === 'tool' ? entry.results.map((r) => r.output) : [],
    );
    expect(outputs[0]).toMatch(
      /^\[output removed to keep the conversation short: 11,000 characters\]$/,
    );
    expect(outputs.at(-1)).toBe(big);
    const messages = last.filter((entry) => entry.role === 'assistant');
    expect(messages.every((entry) => toolCallsOf(entry).length === 1)).toBe(true);
  });

  it('stops when even that is not enough', async () => {
    const { result } = session([answerWith([toolCall('list_files', {})]), finish()], {
      limits: { ...AGENT_LIMITS.shared, maxConversationChars: 10 },
    });
    expect((await result()).outcome).toMatchObject({ kind: 'limit', limit: 'conversation' });
  });
});
