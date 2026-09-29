import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { createFakeClock } from '../fake-clock.js';
import { createStopSource } from '../stop-source.js';
import { fixtureTrace } from '../test/fixture-trace.js';
import { REPLAY_THINK_MS, createReplayModel } from './replay-model.js';
import { createReplayMonitor } from './replay-monitor.js';

const demo = fixtureTrace('demo-agent-5.json');

describe('createReplayModel', () => {
  it('gives the recorded answers in order, each after its thinking time, capped', async () => {
    const clock = createFakeClock(0);
    const model = createReplayModel(demo, clock);
    const deltas: string[] = [];
    const step = model.step({
      inputs: { goal: demo.inputs.goal, files: [] },
      conversation: [],
      signal: createStopSource().signal,
      onText: (delta) => deltas.push(delta),
    });
    const recordedMs = demo.steps[0]?.model?.durationMs ?? 0;
    clock.advance(Math.min(recordedMs, REPLAY_THINK_MS) - 1);
    let answered = false;
    void step.then(() => (answered = true));
    await Promise.resolve();
    expect(answered).toBe(false);
    clock.advance(1);
    const answer = await step;
    expect(answer.message).toEqual(demo.steps[0]?.model?.message);
    expect(answer.model).toEqual({ provider: 'gemini', id: 'gemini-3.5-flash-lite' });
  });
});

describe('createReplayMonitor', () => {
  const finished = (
    outcome: Extract<AgentEvent, { type: 'finished' }>['outcome'],
    steps: number,
  ): AgentEvent => ({
    type: 'finished',
    outcome,
    totals: { steps, inputTokens: 0, outputTokens: 0, durationMs: 0 },
    changes: { created: [], edited: [], renamed: [], deleted: [] },
  });

  it('diverges when the replay ends other than the recording did', () => {
    const monitor = createReplayMonitor(demo);
    expect(
      monitor.observe(finished({ kind: 'limit', limit: 'steps', message: 'used all' }, 15)),
    ).toEqual({
      step: 15,
      toolName: 'finish',
      recorded: 'finished after 4 steps',
      now: 'limit after 15 steps',
    });
    // Only the first divergence counts.
    expect(monitor.observe(finished({ kind: 'stopped' }, 15))).toBeNull();
    expect(monitor.divergence()?.now).toBe('limit after 15 steps');
  });

  it('diverges on a call the recording does not have', () => {
    const monitor = createReplayMonitor(demo);
    expect(
      monitor.observe({
        type: 'tool-finished',
        step: 1,
        toolCallId: 'not-recorded',
        toolName: 'list_files',
        isError: false,
        output: '',
        durationMs: 0,
      }),
    ).toMatchObject({ step: 1, recorded: 'no such call' });
  });
});
