/**
 * The AI teammate in the AI panel: a goal to start it with, a live log of what
 * it does while it runs, and afterwards what it did, with Undo AI changes and
 * Download trace. Everything the model wrote is shown as text (AiText), never
 * as HTML.
 */
import { AGENT_STEP_LIMITS } from '@collabcode/shared';
import { Bot, Check, LoaderCircle, X } from 'lucide-react';
import { useState } from 'react';
import { AiText } from '../ai/AiText.js';
import { PrivacyNotice } from '../ai/PrivacyNotice.js';
import {
  outcomeText,
  runningStatus,
  type AgentSessionState,
  type LogEntry,
} from './agent-session-state.js';
import type { AgentSessionControls } from './useAgentSession.js';

const GOAL_MAX = 2_000;

function Button({
  onClick,
  children,
  primary = false,
  disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? 'bg-sky-600 text-white hover:bg-sky-500'
          : 'border border-zinc-700 text-zinc-200 hover:border-zinc-500'
      }`}
    >
      {children}
    </button>
  );
}

function GoalForm({
  usingOwnKey,
  onStart,
}: {
  usingOwnKey: boolean;
  onStart: (goal: string) => void;
}): React.ReactElement {
  const [goal, setGoal] = useState('');
  const steps = usingOwnKey ? AGENT_STEP_LIMITS.ownKey : AGENT_STEP_LIMITS.shared;
  const submit = (): void => {
    if (goal.trim() !== '') onStart(goal.trim());
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="agent-goal" className="block text-sm text-zinc-300">
        What should the AI teammate do?
      </label>
      <textarea
        id="agent-goal"
        value={goal}
        maxLength={GOAL_MAX}
        rows={3}
        placeholder="Add a DELETE /users/:id endpoint with validation"
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
        }}
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={goal.trim() === ''}
          className="flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Bot className="size-3.5" aria-hidden />
          Start
        </button>
        <p className="text-xs text-zinc-500">
          Up to {steps} steps and 5 minutes.{' '}
          {usingOwnKey
            ? 'Uses your own key.'
            : `Uses ${String(AGENT_STEP_LIMITS.shared)} of your free AI requests at most.`}
        </p>
      </div>
      <p className="text-xs text-zinc-500">
        It edits files everyone can see, runs the project in your browser and calls its API. Files
        someone else is typing in are left alone, and you can undo everything it did.
      </p>
    </form>
  );
}

function LogView({ log }: { log: readonly LogEntry[] }): React.ReactElement {
  return (
    <ol className="space-y-2" aria-label="What the AI teammate did">
      {log.map((entry, index) =>
        entry.kind === 'text' ? (
          <li key={index} className="text-sm text-zinc-300">
            <AiText text={entry.text} />
          </li>
        ) : (
          <li key={entry.toolCallId} className="text-xs">
            <div className="flex items-center gap-1.5 text-zinc-300">
              {entry.state === 'running' && (
                <LoaderCircle className="size-3.5 animate-spin text-sky-300" aria-label="Running" />
              )}
              {entry.state === 'ok' && (
                <Check className="size-3.5 text-emerald-300" aria-label="Done" />
              )}
              {entry.state === 'error' && (
                <X className="size-3.5 text-amber-300" aria-label="Did not work" />
              )}
              <span>{entry.label}</span>
            </div>
            {entry.output !== null && entry.output !== '' && (
              <details className="mt-1 ml-5">
                <summary className="cursor-pointer text-zinc-500">Result</summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-zinc-950 p-2 whitespace-pre-wrap text-zinc-400">
                  {entry.output}
                </pre>
              </details>
            )}
          </li>
        ),
      )}
    </ol>
  );
}

function Notice({ text }: { text: string | null }): React.ReactElement | null {
  if (text === null) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-100"
    >
      {text}
    </p>
  );
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${String(seconds)} s`
    : `${String(Math.floor(seconds / 60))} min ${String(seconds % 60)} s`;
}

function EndedView({
  state,
  controls,
}: {
  state: Extract<AgentSessionState, { phase: 'ended' }>;
  controls: AgentSessionControls;
}): React.ReactElement {
  const { outcome, totals, undo } = state;
  const tokens = (totals.inputTokens + totals.outputTokens).toLocaleString('en-US');
  return (
    <div className="space-y-3">
      <div
        className={`rounded-md border p-2 text-sm ${
          outcome.kind === 'finished'
            ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-50'
            : 'border-zinc-700 bg-zinc-900 text-zinc-200'
        }`}
      >
        {outcome.kind === 'finished' ? (
          <AiText text={outcomeText(outcome)} />
        ) : (
          <p>{outcomeText(outcome)}</p>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        {totals.steps} {totals.steps === 1 ? 'step' : 'steps'} · {tokens} tokens ·{' '}
        {duration(totals.durationMs)}
        {state.remainingToday !== null &&
          ` · ${String(state.remainingToday)} free requests left today`}
      </p>
      <Notice text={state.notice} />
      {undo.kind === 'confirm' && (
        <div
          role="alertdialog"
          aria-label="Undo AI changes?"
          className="space-y-2 rounded-md border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-50"
        >
          <p>
            {undo.changedPaths.length === 1
              ? '1 file the AI changed has been edited by someone else since:'
              : `${String(undo.changedPaths.length)} files the AI changed have been edited by someone else since:`}
          </p>
          <ul className="list-disc pl-4">
            {undo.changedPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          <p>Undo removes only the AI's changes. Their edits stay.</p>
          <div className="flex gap-2">
            <Button primary onClick={controls.confirmUndo}>
              Undo anyway
            </Button>
            <Button onClick={controls.cancelUndo}>Cancel</Button>
          </div>
        </div>
      )}
      {undo.kind === 'nothing' && (
        <p className="text-xs text-zinc-500">It did not change any files.</p>
      )}
      {undo.kind === 'available' && outcome.kind !== 'finished' && (
        <p className="text-xs text-zinc-500">What it changed so far is still there.</p>
      )}
      {undo.kind === 'undone' && (
        <div role="status" className="space-y-1 text-xs text-zinc-300">
          <p>{undo.summary}</p>
          {undo.skipped.map((reason) => (
            <p key={reason} className="text-amber-200">
              Left alone: {reason}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {undo.kind === 'available' && (
          <Button onClick={controls.requestUndo}>Undo AI changes</Button>
        )}
        <Button onClick={controls.downloadTrace}>Download trace</Button>
        <Button onClick={controls.dismiss}>Done</Button>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-zinc-500">What it did</summary>
        <div className="mt-2">
          <LogView log={state.log} />
        </div>
      </details>
    </div>
  );
}

export function AgentPanel({
  controls,
  usingOwnKey,
}: {
  controls: AgentSessionControls;
  usingOwnKey: boolean;
}): React.ReactElement {
  const { state } = controls;
  return (
    <section aria-labelledby="agent-title" className="space-y-3">
      <h2
        id="agent-title"
        className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase"
      >
        <Bot className="size-3.5" aria-hidden />
        AI teammate
      </h2>
      {state.phase === 'idle' && <GoalForm usingOwnKey={usingOwnKey} onStart={controls.start} />}
      {state.phase === 'needs-consent' && (
        <PrivacyNotice onAccept={controls.acceptPrivacyNotice} onCancel={controls.dismiss} />
      )}
      {state.phase === 'starting' && (
        <div className="flex items-center gap-2">
          <p role="status" className="flex-1 text-xs text-sky-300">
            Starting the AI teammate…
          </p>
          <Button onClick={controls.stop}>Stop</Button>
        </div>
      )}
      {state.phase === 'start-failed' && (
        <div className="space-y-2">
          <p
            role="alert"
            className="rounded-md border border-red-900/60 bg-red-950/40 p-2 text-sm text-red-200"
          >
            {state.message}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => controls.start(state.goal)}>Try again</Button>
            <Button onClick={controls.dismiss}>Cancel</Button>
          </div>
        </div>
      )}
      {state.phase === 'running' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p
              role="status"
              aria-live="polite"
              className="min-w-0 flex-1 truncate text-xs text-sky-300"
            >
              {runningStatus(state)}
            </p>
            <Button onClick={controls.stop}>Stop</Button>
          </div>
          <p className="line-clamp-2 text-xs text-zinc-500">{state.goal}</p>
          <Notice text={state.notice} />
          <LogView log={state.log} />
        </div>
      )}
      {state.phase === 'ended' && <EndedView state={state} controls={controls} />}
    </section>
  );
}
