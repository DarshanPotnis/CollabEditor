/**
 * Recorded sessions kept as regression examples (packages/agent/fixtures/traces), read and
 * replayed the way AI-4's evals will: with the recorded answers and no model.
 *
 * model-busy-mid-session.json is a real demo session on the shared tier (2026-09-28,
 * gemini-3.5-flash-lite, prompt agent@1, trace format 1). Gemini was busy throughout: steps 3
 * and 4 were answered only after retries, step 4 ended with finish reason "other", and step 6
 * was refused three times, which ended the session.
 *
 * runtime-unavailable-agent-loops.json is the second demo session (2026-09-28,
 * gemini-3.5-flash-lite, agent@2, trace format 2). The page could not boot a WebContainer, and
 * run_project said so at step 1; the model then made the change, wandered well past the goal
 * (rewrote index.js, added and deleted test files, edited package.json, tried to install
 * supertest), called run_command six times against a sandbox that did not exist, and used all
 * 15 steps without calling finish.
 */
import { readFileSync } from 'node:fs';
import { REPEATED_ERROR_REMINDER, stepsLeftReminder } from '@collabcode/shared';
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
    expect(trace.version).toBe(3);
    expect(trace.steps.every((step) => step.reminder === null)).toBe(true);
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

describe('the "runtime unavailable; agent loops" trace', () => {
  const trace = fixture('runtime-unavailable-agent-loops.json');
  const calls = trace.steps.flatMap((step) => step.toolCalls);

  it('records the case: no sandbox, the same refusal six times, and no finish', () => {
    expect(trace).toMatchObject({
      // Recorded in format 2, before steps kept their reminders.
      version: 3,
      tier: 'shared',
      project: { template: 'express-api' },
      prompt: { id: 'agent', version: 2 },
      outcome: { kind: 'limit', limit: 'steps' },
    });
    expect(trace.steps).toHaveLength(15);
    expect(calls[0]).toMatchObject({ toolName: 'run_project', isError: true });
    expect(calls[0]?.output).toContain('crossOriginIsolated');

    const commands = calls.filter((call) => call.toolName === 'run_command');
    expect(commands).toHaveLength(6);
    expect(new Set(commands.map((call) => `${String(call.isError)} ${call.output}`)).size).toBe(1);
    expect(commands[0]?.output).toContain('run_project first');

    expect(calls.map((call) => call.toolName)).not.toContain('finish');
    expect(calls.map((call) => call.toolName)).not.toContain('http_request');
    expect(trace.steps.map((step) => step.waits.length)).toEqual([
      0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 0, 0, 2, 1, 0,
    ]);
  });

  it('records the scope creep: files the goal never asked for', () => {
    const touched = calls
      .filter((call) => !call.isError && call.toolName !== 'run_project')
      .map((call) => `${call.toolName} ${String((call.input as { path?: unknown }).path)}`);
    expect(touched).toEqual([
      'edit_file index.js',
      'edit_file routes/users.js',
      'create_file routes/users.test.js',
      'delete_file routes/users.test.js',
      'create_file test/users.test.js',
      'edit_file package.json',
      'delete_file test/users.test.js',
      'create_file test/users.test.js',
    ]);
  });

  it('replays with its rate-limit waits: the same calls and the same end', async () => {
    const { result, tools, recorded } = await replay(trace, true);
    expect(tools.calls).toEqual(
      recorded.map((call) => ({ name: call.toolName, input: call.input })),
    );
    expect(result.outcome).toEqual(trace.outcome);
    expect(result.trace.steps.map((step) => step.waits.map((wait) => wait.reason))).toEqual(
      trace.steps.map((step) => step.waits.map((wait) => wait.reason)),
    );
  });

  it('would now have been reminded: of the repeated refusal from step 9, of its steps from 13', async () => {
    const { result } = await replay(trace, false);
    const repeated = REPEATED_ERROR_REMINDER;
    expect(result.trace.steps.map((step) => step.reminder)).toEqual([
      ...Array<null>(8).fill(null),
      repeated,
      null,
      repeated,
      null,
      stepsLeftReminder(3),
      `${repeated}\n\n${stepsLeftReminder(2)}`,
      `${repeated}\n\n${stepsLeftReminder(1)}`,
    ]);
  });
});
