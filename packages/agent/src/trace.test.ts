import { PROMPTS } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from './fake-clock.js';
import { runAgent } from './loop.js';
import { answerWith, createScriptedModel, scriptFromTrace, toolCall } from './scripted-model.js';
import { createStopSource } from './stop-source.js';
import { drive, recordingHost } from './test/support.js';
import { TRACE_FORMAT, parseTrace } from './trace.js';
import { ModelStepError, type ModelClient } from './types.js';

const KEY_CANARY = 'sk-trace-canary-5d1e';

async function recordedSession(model: ModelClient) {
  const clock = createFakeClock(1_700_000_000_000);
  const tools = recordingHost((call) => ({
    ok: call.name !== 'read_file',
    output: call.name === 'read_file' ? 'No file x.js.' : `${call.name} done`,
  }));
  const run = runAgent({
    sessionId: 'session-7',
    inputs: { goal: 'Fix the crash', files: ['index.js'], moreFiles: 2 },
    tier: 'ownKey',
    model,
    tools,
    clock,
    stop: createStopSource().signal,
    project: { template: 'express-api', filesFingerprint: 'fp-123' },
    random: () => 0.5,
  });
  return { result: await drive(clock, run), tools };
}

const script = [
  { error: new ModelStepError('busy', 'Busy.', { upFront: true }) },
  answerWith(
    [toolCall('read_file', { path: 'x.js' }, 'c1'), toolCall('list_files', {}, 'c2')],
    'Looking.',
  ),
  {
    message: { role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'Thinking.' }] },
  },
  answerWith([toolCall('finish', { summary: 'Nothing to fix.' }, 'c3')]),
];

describe('the trace', () => {
  it('records the start, each answer verbatim, the waits, the calls and the end', async () => {
    const { result } = await recordedSession(createScriptedModel(script));
    const { trace } = result;

    expect(trace).toMatchObject({
      format: TRACE_FORMAT,
      version: 2,
      sessionId: 'session-7',
      startedAt: 1_700_000_000_000,
      project: { template: 'express-api', filesFingerprint: 'fp-123' },
      inputs: { goal: 'Fix the crash', files: ['index.js'], moreFiles: 2 },
      prompt: { id: 'agent', version: PROMPTS.agent.version },
      tier: 'ownKey',
      outcome: { kind: 'finished', summary: 'Nothing to fix.' },
      totals: { steps: 3 },
    });
    expect(trace.steps).toHaveLength(3);
    expect(trace.steps[0]?.waits).toEqual([{ reason: 'busy', waitMs: 5_000, attemptMs: 0 }]);
    // The model time is the attempt that answered, not the wait before it.
    expect(trace.steps[0]?.model?.durationMs).toBe(0);
    expect(trace.steps[0]?.model?.rawFinishReason).toBeNull();
    expect(trace.steps[0]?.model?.message).toEqual(
      script[1] && 'message' in script[1] ? script[1].message : null,
    );
    expect(
      trace.steps[0]?.toolCalls.map((call) => [call.toolName, call.isError, call.output]),
    ).toEqual([
      ['read_file', true, 'No file x.js.'],
      ['list_files', false, 'list_files done'],
    ]);
    expect(trace.steps[1]?.nudged).toBe(true);
    expect(trace.steps[2]?.toolCalls[0]).toMatchObject({ toolName: 'finish', output: '' });
  });

  it('survives being written as JSON and read back', async () => {
    const { result } = await recordedSession(createScriptedModel(script));
    const written: unknown = JSON.parse(JSON.stringify(result.trace));
    expect(parseTrace(written)).toEqual(result.trace);
  });

  it('refuses something that is not a trace of this version', async () => {
    const { result } = await recordedSession(createScriptedModel(script));
    expect(parseTrace({ ...result.trace, version: 3 })).toBeNull();
    expect(parseTrace({ ...result.trace, format: 'other' })).toBeNull();
    expect(parseTrace('not a trace')).toBeNull();
  });

  it('reads a version 1 trace, with what it did not record left null', async () => {
    const { result } = await recordedSession(createScriptedModel(script));
    const v1 = {
      ...result.trace,
      version: 1,
      steps: result.trace.steps.map((step) => ({
        ...step,
        waits: step.waits.map(({ reason, waitMs }) => ({ reason, waitMs })),
        model: step.model && {
          provider: step.model.provider,
          id: step.model.id,
          durationMs: 137_000,
          finishReason: step.model.finishReason,
          usage: step.model.usage,
          message: step.model.message,
        },
      })),
    };
    const upgraded = parseTrace(JSON.parse(JSON.stringify(v1)));
    expect(upgraded?.version).toBe(2);
    expect(upgraded?.steps[0]?.waits).toEqual([{ reason: 'busy', waitMs: 5_000, attemptMs: null }]);
    expect(upgraded?.steps[0]?.model).toMatchObject({ durationMs: 137_000, rawFinishReason: null });
  });

  it('replays with no model: the same calls, in the same order, to the same end', async () => {
    const recorded = await recordedSession(createScriptedModel(script));
    const replayed = await recordedSession(scriptFromTrace(recorded.result.trace));

    expect(replayed.tools.calls).toEqual(recorded.tools.calls);
    expect(replayed.result.outcome).toEqual(recorded.result.outcome);
    expect(replayed.result.trace.steps.map((step) => step.model?.message)).toEqual(
      recorded.result.trace.steps.map((step) => step.model?.message),
    );
  });

  it('never holds the key the model client uses', async () => {
    const inner = createScriptedModel(script);
    // A client like the browser's: it has the person's key and sends it with every call.
    const withKey: ModelClient = {
      step: (request) => {
        const headers = { 'x-ai-key': KEY_CANARY };
        expect(headers['x-ai-key']).toBe(KEY_CANARY);
        return inner.step(request);
      },
    };
    const { result } = await recordedSession(withKey);
    expect(JSON.stringify(result.trace)).not.toContain(KEY_CANARY);
  });
});
