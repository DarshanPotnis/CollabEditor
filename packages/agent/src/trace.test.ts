import { PROMPTS, REPEATED_ERROR_REMINDER, stepsLeftReminder } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from './fake-clock.js';
import { AGENT_LIMITS } from './limits.js';
import { runAgent } from './loop.js';
import { answerWith, createScriptedModel, scriptFromTrace, toolCall } from './scripted-model.js';
import { createStopSource } from './stop-source.js';
import { drive, recordingHost } from './test/support.js';
import { TRACE_FORMAT, TRACE_VERSION, parseTrace } from './trace.js';
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
      version: TRACE_VERSION,
      sessionId: 'session-7',
      startedAt: 1_700_000_000_000,
      project: { template: 'express-api', filesFingerprint: 'fp-123' },
      inputs: { goal: 'Fix the crash', files: ['index.js'], moreFiles: 2 },
      prompt: { id: 'agent', version: PROMPTS.agent.version },
      tier: 'ownKey',
      outcome: { kind: 'finished', summary: 'Nothing to fix.', checks: { made: [], notMade: [] } },
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
    expect(parseTrace({ ...result.trace, version: TRACE_VERSION + 1 })).toBeNull();
    expect(parseTrace({ ...result.trace, format: 'other' })).toBeNull();
    expect(parseTrace('not a trace')).toBeNull();
  });

  it('reads a version 1 trace, with what it did not record left null', async () => {
    const { result } = await recordedSession(createScriptedModel(script));
    const v1 = {
      ...result.trace,
      version: 1,
      outcome: { kind: 'finished', summary: 'Nothing to fix.' },
      steps: result.trace.steps.map(({ reminder: _unrecorded, ...step }) => ({
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
    expect(upgraded?.version).toBe(TRACE_VERSION);
    expect(upgraded?.outcome).toEqual({
      kind: 'finished',
      summary: 'Nothing to fix.',
      checks: null,
    });
    expect(upgraded?.steps[0]?.waits).toEqual([{ reason: 'busy', waitMs: 5_000, attemptMs: null }]);
    expect(upgraded?.steps[0]?.model).toMatchObject({ durationMs: 137_000, rawFinishReason: null });
    expect(upgraded?.steps.map((step) => step.reminder)).toEqual([null, null, null]);
  });

  it('reads a version 2 trace, which recorded no reminders', async () => {
    const { result } = await recordedSession(createScriptedModel(script));
    const v2 = {
      ...result.trace,
      version: 2,
      steps: result.trace.steps.map(({ reminder: _unrecorded, ...step }) => step),
      outcome: { kind: 'finished', summary: 'Nothing to fix.' },
    };
    const upgraded = parseTrace(JSON.parse(JSON.stringify(v2)));
    expect(upgraded).toEqual({
      ...result.trace,
      steps: result.trace.steps.map((step) => ({ ...step, reminder: null })),
      outcome: { kind: 'finished', summary: 'Nothing to fix.', checks: null },
    });
  });

  it('reads a version 3 trace, whose finish listed no checks', async () => {
    const { result } = await recordedSession(createScriptedModel(script));
    const v3 = { ...result.trace, version: 3, outcome: { kind: 'finished', summary: 'Done.' } };
    expect(parseTrace(JSON.parse(JSON.stringify(v3)))).toEqual({
      ...result.trace,
      outcome: { kind: 'finished', summary: 'Done.', checks: null },
    });
    const stopped = { ...result.trace, version: 3, outcome: { kind: 'stopped' } };
    expect(parseTrace(stopped)?.outcome).toEqual({ kind: 'stopped' });
  });

  it('records what each step was reminded of, and a page that could not run code', async () => {
    const clock = createFakeClock();
    const run = runAgent({
      sessionId: 'session-8',
      inputs: { goal: 'Fix it', files: ['index.js'], sandbox: 'unavailable' },
      tier: 'ownKey',
      limits: { ...AGENT_LIMITS.ownKey, maxSteps: 3 },
      model: createScriptedModel([
        answerWith([toolCall('read_file', { path: 'x.js' }, 'c1')]),
        answerWith([toolCall('read_file', { path: 'x.js' }, 'c2')]),
        answerWith([toolCall('finish', { summary: 'Could not find x.js.' }, 'c3')]),
      ]),
      tools: recordingHost(() => ({ ok: false, output: 'No file x.js.' })),
      clock,
      stop: createStopSource().signal,
      project: { template: null, filesFingerprint: 'fp' },
    });
    const { trace } = await drive(clock, run);

    expect(trace.inputs.sandbox).toBe('unavailable');
    expect(trace.steps.map((step) => step.reminder)).toEqual([
      stepsLeftReminder(3),
      // The first refusal is not a repeat.
      stepsLeftReminder(2),
      `${REPEATED_ERROR_REMINDER}\n\n${stepsLeftReminder(1)}`,
    ]);
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
