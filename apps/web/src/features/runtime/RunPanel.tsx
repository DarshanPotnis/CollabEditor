/**
 * The right-hand pane: run the project in this browser (PLAN.md §10).
 *
 * Nothing runs until this person clicks Run, and their run is theirs alone.
 * The note under the buttons says what that means: the code includes
 * collaborators' edits, and their changes restart the server.
 */
import { lazy, Suspense, useMemo } from 'react';
import { Play, RotateCw, Square } from 'lucide-react';
import type { ProjectSession } from '../../collab/useProject.js';
import { canRun } from './run-state.js';
import { runStatus, type RunStatus } from './run-status.js';
import { runtimeSupport } from './runtime-support.js';
import { useRuntime } from './useRuntime.js';

const TerminalView = lazy(() => import('./TerminalView.js'));

const TONE_CLASS: Record<RunStatus['tone'], string> = {
  idle: 'text-zinc-400',
  busy: 'text-sky-300',
  ok: 'text-emerald-300',
  error: 'text-red-300',
};

function Button({
  label,
  onClick,
  disabled = false,
  primary = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
          : 'border border-zinc-700 text-zinc-200 hover:border-zinc-500'
      }`}
    >
      {children}
      {label}
    </button>
  );
}

export type RunPanelProps = {
  session: ProjectSession | null;
  onSyncError: (message: string) => void;
};

export function RunPanel({ session, onSyncError }: RunPanelProps): React.ReactElement {
  const { state, output, dependenciesChanged, run, stop } = useRuntime(session, onSyncError);
  const support = useMemo(
    () =>
      runtimeSupport({
        crossOriginIsolated: window.crossOriginIsolated,
        userAgent: navigator.userAgent,
      }),
    [],
  );
  const status = runStatus(state);
  const hasRun = state.phase !== 'idle';

  return (
    <section aria-labelledby="run-heading" className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <h2
          id="run-heading"
          className="flex-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase"
        >
          Run
        </h2>
        {canRun(state) ? (
          <Button
            label="Run"
            primary
            onClick={run}
            disabled={!session || support.kind === 'unsupported'}
          >
            <Play className="size-3.5" aria-hidden />
          </Button>
        ) : (
          <>
            <Button label="Restart" onClick={run}>
              <RotateCw className="size-3.5" aria-hidden />
            </Button>
            <Button label="Stop" onClick={stop}>
              <Square className="size-3.5" aria-hidden />
            </Button>
          </>
        )}
      </div>

      <div className="space-y-1.5 border-b border-zinc-800 px-3 py-2 text-xs">
        <p role="status" aria-label="Run status" className={TONE_CLASS[status.tone]}>
          {status.text}
        </p>
        {support.kind !== 'supported' && <p className="text-amber-200">{support.message}</p>}
        {dependenciesChanged && (
          <p className="text-amber-200">
            package.json dependencies changed since the last install.{' '}
            <button type="button" onClick={run} className="font-medium underline">
              Restart to install
            </button>
          </p>
        )}
        <p className="text-zinc-500">
          Runs this project in your browser only, with everyone's latest edits. Their changes
          restart your server.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        {hasRun ? (
          <Suspense fallback={<p className="p-3 text-xs text-zinc-500">Loading the terminal…</p>}>
            <TerminalView label="Run output" source={output} />
          </Suspense>
        ) : (
          <p className="p-3 text-xs text-zinc-500">Output appears here when you run the project.</p>
        )}
      </div>
    </section>
  );
}
