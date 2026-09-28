/**
 * Recorded sessions kept as regression examples (packages/agent/fixtures/traces), read and
 * replayed the way AI-4's evals will: with the recorded answers and no model.
 *
 * model-busy-mid-session.json is a real demo session on the shared tier (2026-09-28,
 * gemini-3.5-flash-lite, prompt agent@1, trace format 1). Gemini was busy throughout: steps 3
 * and 4 were answered only after retries, step 4 ended with finish reason "other", and step 6
 * was refused three times, which ended the session.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from './fake-clock.js';
import { runAgent } from './loop.js';
import { scriptFromTrace } from './scripted-model.js';
import { createStopSource } from './stop-source.js';
import { drive, recordingHost } from './test/support.js';
import { parseTrace, type AgentTrace } from './trace.js';

function fixture(name: string): AgentTrace {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../fixtures/traces/${name}`, import.meta.url), 'utf8'),
  );
  const trace = parseTrace(raw);
  if (!trace) throw new Error(`${name} is not a trace this version can read`);
  return trace;
}

/** Replays a trace against a ToolHost that gives back each recorded result in turn. */
async function replay(trace: AgentTrace, failures: boolean) {
  const recorded = trace.steps.flatMap((step) => step.toolCalls);
  let next = 0;
  const tools = recordingHost(() => {
    const call = recorded[next];
    next += 1;
    return { ok: !(call?.isError ?? true), output: call?.output ?? '' };
  });
  const clock = createFakeClock(trace.startedAt);
  const result = await drive(
    clock,
    runAgent({
      sessionId: trace.sessionId,
      inputs: trace.inputs,
      tier: trace.tier,
      limits: trace.limits,
      model: scriptFromTrace(trace, { failures }),
      tools,
      clock,
      stop: createStopSource().signal,
      project: trace.project,
      random: () => 0.5,
    }),
  );
  return { result, tools, recorded, elapsedMs: clock.now() - trace.startedAt };
}

describe('the "model busy mid-session" trace', () => {
  const trace = fixture('model-busy-mid-session.json');

  it('is read, upgraded from format 1 with what it did not record left null', () => {
    expect(trace.version).toBe(2);
    expect(trace.steps).toHaveLength(6);
    expect(trace.steps.flatMap((step) => step.waits).every((wait) => wait.attemptMs === null)).toBe(
      true,
    );
    expect(
      trace.steps.every((step) => step.model === null || step.model.rawFinishReason === null),
    ).toBe(true);
  });

  it('records a busy model: retries that were answered, then a step that never was', () => {
    expect(trace).toMatchObject({
      tier: 'shared',
      project: { template: 'express-api' },
      prompt: { id: 'agent', version: 1 },
      outcome: {
        kind: 'failed',
        reason: 'model',
        message: expect.stringContaining('busy') as string,
      },
    });
    expect(trace.steps.map((step) => step.waits.map((wait) => wait.reason))).toEqual([
      [],
      [],
      ['busy'],
      ['busy', 'busy'],
      [],
      ['busy', 'busy'],
    ]);
    expect(trace.steps[3]?.model?.finishReason).toBe('other');
    expect(trace.steps[5]?.model).toBeNull();
    expect(trace.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName))).toEqual([
      'list_files',
      'read_file',
      'read_file',
      'read_file',
      'run_project',
    ]);
  });

  it('replays with its failures: the same calls, the same retries, the same end', async () => {
    const { result, tools, recorded } = await replay(trace, true);

    expect(tools.calls).toEqual(
      recorded.map((call) => ({ name: call.toolName, input: call.input })),
    );
    expect(result.outcome).toEqual(trace.outcome);
    expect(result.trace.steps.map((step) => step.waits.map((wait) => wait.reason))).toEqual(
      trace.steps.map((step) => step.waits.map((wait) => wait.reason)),
    );
    // Step 4's answer ended with "other" and its tool call was still carried out.
    expect(result.trace.steps[3]?.toolCalls[0]?.toolName).toBe('read_file');
  });

  it('replays as a demo would, never waiting', async () => {
    const { result, tools, recorded, elapsedMs } = await replay(trace, false);
    expect(tools.calls).toHaveLength(recorded.length);
    expect(result.trace.steps.flatMap((step) => step.waits)).toEqual([]);
    expect(elapsedMs).toBe(0);
  });
});
