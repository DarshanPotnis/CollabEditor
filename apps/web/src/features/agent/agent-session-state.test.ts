import type { AgentEvent, AgentTrace } from '@collabcode/agent';
import { describe, expect, it } from 'vitest';
import {
  IDLE_AGENT_SESSION,
  LOG_OUTPUT_CHARS,
  agentSessionReducer,
  outcomeText,
  runningStatus,
  type AgentSessionEvent,
  type AgentSessionState,
} from './agent-session-state.js';

const totals = { steps: 2, inputTokens: 1_800, outputTokens: 60, durationMs: 42_000 };
const changes = { created: [], edited: ['routes/users.js'], renamed: [], deleted: [] };

function play(...events: AgentSessionEvent[]): AgentSessionState {
  return events.reduce(agentSessionReducer, IDLE_AGENT_SESSION);
}

const agent = (event: AgentEvent, at = 100_000): AgentSessionEvent => ({
  type: 'agent',
  event,
  at,
});
const begin: AgentSessionEvent[] = [
  { type: 'request', goal: 'Add a route', consented: true },
  { type: 'started', maxSteps: 15, modelName: 'Gemini', agentClientId: 42 },
];

function running(state: AgentSessionState) {
  if (state.phase !== 'running') throw new Error(`not running: ${state.phase}`);
  return state;
}

describe('agentSessionReducer', () => {
  it('asks for the privacy notice first, when it has not been accepted', () => {
    expect(play({ type: 'request', goal: 'Add a route', consented: false })).toEqual({
      phase: 'needs-consent',
      goal: 'Add a route',
    });
    expect(
      play({ type: 'request', goal: 'Add a route', consented: false }, { type: 'consented' }).phase,
    ).toBe('starting');
  });

  it('logs streamed text and tool calls, with what each did', () => {
    const state = running(
      play(
        ...begin,
        agent({ type: 'step-started', step: 1, maxSteps: 15 }),
        agent({ type: 'text', step: 1, delta: 'Let me ' }),
        agent({ type: 'text', step: 1, delta: 'look.' }),
        agent({
          type: 'tool-started',
          step: 1,
          toolCallId: 'c1',
          toolName: 'read_file',
          input: { path: 'a.js' },
        }),
      ),
    );
    expect(state.log).toEqual([
      { kind: 'text', step: 1, text: 'Let me look.' },
      {
        kind: 'tool',
        step: 1,
        toolCallId: 'c1',
        toolName: 'read_file',
        label: 'Reading a.js',
        state: 'running',
        output: null,
      },
    ]);
    expect(runningStatus(state, 100_000)).toBe('Step 1 of 15 · Reading a.js');

    const done = running(
      agentSessionReducer(
        state,
        agent({
          type: 'tool-finished',
          step: 1,
          toolCallId: 'c1',
          toolName: 'read_file',
          isError: true,
          output: 'x'.repeat(LOG_OUTPUT_CHARS + 10),
          durationMs: 5,
        }),
      ),
    );
    expect(done.log[1]).toMatchObject({ state: 'error' });
    expect(done.log[1]?.kind === 'tool' && done.log[1].output?.length).toBe(LOG_OUTPUT_CHARS);
    expect(runningStatus(done, 100_000)).toBe('Step 1 of 15 · Thinking');
  });

  it('says when the model is busy and counts down to the retry, never "Thinking"', () => {
    const state = running(
      play(
        ...begin,
        agent({ type: 'step-started', step: 1, maxSteps: 15 }),
        agent({ type: 'waiting', step: 1, reason: 'busy', waitMs: 5_200 }, 100_000),
      ),
    );
    expect(runningStatus(state, 100_000)).toBe('Gemini is busy, retrying in 6 s');
    expect(runningStatus(state, 103_000)).toBe('Gemini is busy, retrying in 3 s');
    // The retry has gone out; until the model answers, that is what is happening.
    expect(runningStatus(state, 106_000)).toBe('Gemini is busy, retrying…');
    const answered = running(
      agentSessionReducer(
        state,
        agent({
          type: 'model-answered',
          step: 1,
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1 },
          model: { provider: 'gemini', id: 'm' },
          remainingToday: 12,
        }),
      ),
    );
    expect(answered.waiting).toBeNull();
    expect(answered.remainingToday).toBe(12);
  });

  it('shows a notice such as delayed sync until the next step', () => {
    const state = play(...begin, {
      type: 'notice',
      message: 'Sync with the running project is delayed.',
    });
    expect(running(state).notice).toBe('Sync with the running project is delayed.');
    expect(
      running(agentSessionReducer(state, agent({ type: 'step-started', step: 2, maxSteps: 15 })))
        .notice,
    ).toBeNull();
  });

  it('ends with the outcome, marking a tool cut short as failed', () => {
    const state = play(
      ...begin,
      agent({
        type: 'tool-started',
        step: 1,
        toolCallId: 'c1',
        toolName: 'run_project',
        input: {},
      }),
      agent({ type: 'finished', outcome: { kind: 'stopped' }, totals, changes }),
    );
    expect(state).toMatchObject({ phase: 'ended', totals, changes, undo: { kind: 'available' } });
    expect(state.phase === 'ended' && state.log[0]).toMatchObject({ state: 'error' });
  });

  it('confirms an undo only when asked, and records the result', () => {
    const ended = play(
      ...begin,
      agent({
        type: 'finished',
        outcome: { kind: 'finished', summary: 'Done.', checks: null },
        totals,
        changes,
      }),
    );
    const asking = agentSessionReducer(ended, {
      type: 'undo-asked',
      changedPaths: ['routes/users.js'],
    });
    expect(asking).toMatchObject({ undo: { kind: 'confirm', changedPaths: ['routes/users.js'] } });
    expect(agentSessionReducer(asking, { type: 'undo-cancelled' })).toMatchObject({
      undo: { kind: 'available' },
    });
    expect(
      agentSessionReducer(asking, { type: 'undone', summary: 'Undid it.', skipped: [] }),
    ).toMatchObject({
      undo: { kind: 'undone', summary: 'Undid it.' },
    });
    expect(agentSessionReducer(ended, { type: 'nothing-to-undo' })).toMatchObject({
      undo: { kind: 'nothing' },
    });
  });

  it('ignores a second start and a dismiss while running', () => {
    const state = play(...begin);
    expect(agentSessionReducer(state, { type: 'request', goal: 'Other', consented: true })).toBe(
      state,
    );
    expect(agentSessionReducer(state, { type: 'dismiss' })).toBe(state);
  });

  it('ignores events from a session that has ended', () => {
    const ended = play(
      ...begin,
      agent({ type: 'finished', outcome: { kind: 'stopped' }, totals, changes }),
    );
    expect(agentSessionReducer(ended, agent({ type: 'text', step: 1, delta: 'late' }))).toBe(ended);
  });
});

describe('a replay, and the session’s trace', () => {
  const label = {
    recordedAt: 1_790_000_000_000,
    prompt: 'agent@5',
    model: 'gemini-3.5-flash-lite',
  };
  const divergence = {
    step: 2,
    toolName: 'edit_file',
    recorded: 'edited lines 12–16',
    now: 'error: Someone else is editing routes/users.js right now',
  };

  it('starts a replay with no privacy notice, since nothing goes to a model, and keeps its label', () => {
    const state = running(
      play(
        { type: 'replay-requested', goal: 'Add a DELETE route', replay: label },
        { type: 'started', maxSteps: 15, modelName: 'Gemini', agentClientId: 7 },
      ),
    );
    expect(state).toMatchObject({ goal: 'Add a DELETE route', replay: label, divergence: null });
  });

  it('keeps the first divergence of a replay, into its ending', () => {
    const ended = play(
      { type: 'replay-requested', goal: 'Add a DELETE route', replay: label },
      { type: 'started', maxSteps: 15, modelName: 'Gemini', agentClientId: 7 },
      { type: 'replay-diverged', divergence },
      { type: 'replay-diverged', divergence: { ...divergence, step: 3 } },
      agent({ type: 'finished', outcome: { kind: 'stopped' }, totals, changes }),
    );
    expect(ended).toMatchObject({ phase: 'ended', replay: label, divergence });
  });

  it('takes the session’s trace once it is in, for the timeline', () => {
    const ended = play(
      ...begin,
      agent({
        type: 'finished',
        outcome: { kind: 'finished', summary: 'Done.', checks: null },
        totals,
        changes,
      }),
    );
    expect(ended).toMatchObject({ phase: 'ended', trace: null, replay: null });
    const trace = { sessionId: 's' } as unknown as AgentTrace;
    expect(agentSessionReducer(ended, { type: 'recorded', trace })).toMatchObject({ trace });
  });
});

describe('outcomeText', () => {
  it('shows the summary, or why the session ended', () => {
    expect(
      outcomeText({ kind: 'finished', summary: 'Added DELETE /users/:id.', checks: null }),
    ).toBe('Added DELETE /users/:id.');
    expect(outcomeText({ kind: 'limit', limit: 'steps', message: 'Used all 15 steps.' })).toBe(
      'Used all 15 steps.',
    );
    expect(outcomeText({ kind: 'stopped' })).toBe('You stopped the AI teammate.');
  });
});
