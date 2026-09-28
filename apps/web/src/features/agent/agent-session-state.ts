/**
 * What the agent panel shows, as a pure reducer over what the session
 * reports (the core's AgentEvents) and what the person does. Kept apart from
 * React so every state is easy to reach in a test.
 */
import type { AgentEvent, AgentOutcome, AgentTotals, SessionChanges } from '@collabcode/agent';
import { toolStatus } from './agent-status.js';

/** A tool's output shown in the log is capped; the trace keeps all of it. */
export const LOG_OUTPUT_CHARS = 4_000;

export type LogEntry =
  | { kind: 'text'; step: number; text: string }
  | {
      kind: 'tool';
      step: number;
      toolCallId: string;
      toolName: string;
      /** What it did, in words, such as "Editing routes/users.js". */
      label: string;
      state: 'running' | 'ok' | 'error';
      output: string | null;
    };

export type UndoView =
  | { kind: 'available' }
  | { kind: 'nothing' }
  | { kind: 'confirm'; changedPaths: string[] }
  | { kind: 'undone'; summary: string; skipped: string[] };

/** A wait before the next try, and when (epoch ms) that try goes out. */
export type Waiting = { reason: 'busy' | 'rate-limited'; until: number };

type Common = {
  goal: string;
  log: LogEntry[];
  notice: string | null;
  remainingToday: number | null;
};

export type AgentSessionState =
  | { phase: 'idle' }
  | { phase: 'needs-consent'; goal: string }
  | { phase: 'starting'; goal: string }
  | { phase: 'start-failed'; goal: string; message: string }
  | (Common & {
      phase: 'running';
      step: number;
      maxSteps: number;
      waiting: Waiting | null;
      /** Who is answering, for "Gemini is busy": Gemini, Claude or OpenAI. */
      modelName: string;
      /** The agent's awareness client, which follow mode watches. */
      agentClientId: number;
    })
  | (Common & {
      phase: 'ended';
      outcome: AgentOutcome;
      totals: AgentTotals;
      /** What it changed, from its trace, for an ending without the model's summary. */
      changes: SessionChanges;
      undo: UndoView;
    });

export type AgentSessionEvent =
  | { type: 'request'; goal: string; consented: boolean }
  | { type: 'consented' }
  | { type: 'started'; maxSteps: number; modelName: string; agentClientId: number }
  | { type: 'start-failed'; message: string }
  /** `at` is when it arrived, which a wait's countdown starts from. */
  | { type: 'agent'; event: AgentEvent; at: number }
  | { type: 'notice'; message: string }
  | { type: 'nothing-to-undo' }
  | { type: 'undo-asked'; changedPaths: string[] }
  | { type: 'undo-cancelled' }
  | { type: 'undone'; summary: string; skipped: string[] }
  | { type: 'dismiss' };

export const IDLE_AGENT_SESSION: AgentSessionState = { phase: 'idle' };

function appendText(log: LogEntry[], step: number, delta: string): LogEntry[] {
  const last = log.at(-1);
  if (last?.kind === 'text' && last.step === step) {
    return [...log.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...log, { kind: 'text', step, text: delta }];
}

function running(
  state: Extract<AgentSessionState, { phase: 'running' }>,
  event: AgentEvent,
  at: number,
): AgentSessionState {
  switch (event.type) {
    case 'step-started':
      return { ...state, step: event.step, maxSteps: event.maxSteps, waiting: null, notice: null };
    case 'text':
      return { ...state, log: appendText(state.log, event.step, event.delta) };
    case 'waiting':
      return { ...state, waiting: { reason: event.reason, until: at + event.waitMs } };
    case 'model-answered':
      return { ...state, waiting: null, remainingToday: event.remainingToday };
    case 'tool-started':
      return {
        ...state,
        log: [
          ...state.log,
          {
            kind: 'tool',
            step: event.step,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            label: toolStatus(event.toolName, event.input),
            state: 'running',
            output: null,
          },
        ],
      };
    case 'tool-finished':
      return {
        ...state,
        log: state.log.map((entry) =>
          entry.kind === 'tool' && entry.toolCallId === event.toolCallId
            ? {
                ...entry,
                state: event.isError ? 'error' : 'ok',
                output: event.output.slice(0, LOG_OUTPUT_CHARS),
              }
            : entry,
        ),
      };
    case 'crashed':
      return state;
    case 'finished':
      return {
        phase: 'ended',
        goal: state.goal,
        log: state.log.map((entry) =>
          entry.kind === 'tool' && entry.state === 'running' ? { ...entry, state: 'error' } : entry,
        ),
        notice: state.notice,
        remainingToday: state.remainingToday,
        outcome: event.outcome,
        totals: event.totals,
        changes: event.changes,
        undo: { kind: 'available' },
      };
  }
}

export function agentSessionReducer(
  state: AgentSessionState,
  event: AgentSessionEvent,
): AgentSessionState {
  switch (event.type) {
    case 'request':
      if (state.phase === 'running' || state.phase === 'starting') return state;
      return event.consented
        ? { phase: 'starting', goal: event.goal }
        : { phase: 'needs-consent', goal: event.goal };
    case 'consented':
      return state.phase === 'needs-consent' ? { phase: 'starting', goal: state.goal } : state;
    case 'started':
      return state.phase === 'starting'
        ? {
            phase: 'running',
            goal: state.goal,
            log: [],
            notice: null,
            remainingToday: null,
            step: 0,
            maxSteps: event.maxSteps,
            waiting: null,
            modelName: event.modelName,
            agentClientId: event.agentClientId,
          }
        : state;
    case 'start-failed':
      return state.phase === 'starting'
        ? { phase: 'start-failed', goal: state.goal, message: event.message }
        : state;
    case 'agent':
      return state.phase === 'running' ? running(state, event.event, event.at) : state;
    case 'notice':
      return state.phase === 'running' || state.phase === 'ended'
        ? { ...state, notice: event.message }
        : state;
    case 'nothing-to-undo':
      return state.phase === 'ended' ? { ...state, undo: { kind: 'nothing' } } : state;
    case 'undo-asked':
      return state.phase === 'ended' && state.undo.kind === 'available'
        ? { ...state, undo: { kind: 'confirm', changedPaths: event.changedPaths } }
        : state;
    case 'undo-cancelled':
      return state.phase === 'ended' && state.undo.kind === 'confirm'
        ? { ...state, undo: { kind: 'available' } }
        : state;
    case 'undone':
      return state.phase === 'ended'
        ? { ...state, undo: { kind: 'undone', summary: event.summary, skipped: event.skipped } }
        : state;
    case 'dismiss':
      return state.phase === 'running' || state.phase === 'starting' ? state : IDLE_AGENT_SESSION;
  }
}

/**
 * One line for the panel: what the session is doing now. While a busy model's
 * retry is due it counts down; once the retry has gone out it says so, until
 * the model answers.
 */
export function runningStatus(
  state: Extract<AgentSessionState, { phase: 'running' }>,
  now: number,
): string {
  if (state.waiting) {
    const seconds = Math.ceil((state.waiting.until - now) / 1000);
    if (state.waiting.reason === 'busy') {
      return seconds > 0
        ? `${state.modelName} is busy, retrying in ${String(seconds)} s`
        : `${state.modelName} is busy, retrying…`;
    }
    return seconds > 0
      ? `Waiting ${String(seconds)} s for the free AI tier`
      : 'Trying the free AI tier again…';
  }
  const lastTool = state.log.findLast((entry) => entry.kind === 'tool');
  const doing =
    lastTool?.kind === 'tool' && lastTool.state === 'running' ? lastTool.label : 'Thinking';
  return state.step === 0
    ? 'Starting'
    : `Step ${String(state.step)} of ${String(state.maxSteps)} · ${doing}`;
}

/** What ended the session, for the panel. */
export function outcomeText(outcome: AgentOutcome): string {
  switch (outcome.kind) {
    case 'finished':
      return outcome.summary;
    case 'stopped':
      return 'You stopped the AI teammate.';
    case 'limit':
    case 'failed':
      return outcome.message;
  }
}
