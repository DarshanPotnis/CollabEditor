/**
 * The right-hand pane: run the project in this browser (PLAN.md §10).
 *
 * Nothing runs until this person clicks Run, and their run is theirs alone.
 * The note under the status says what that means: the code includes
 * collaborators' edits, and their changes restart the server.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Play, RotateCw, Sparkles, Square } from 'lucide-react';
import type { ProjectSession } from '../../collab/useProject.js';
import { runFailure, type RunFailure } from '../ai/prompts/error-prompt.js';
import { RAW_OUTPUT_CHARS } from '../ai/terminal-text.js';
import { canRun } from './run-state.js';
import { runStatus, type RunStatus } from './run-status.js';
import { runtimeSupport } from './runtime-support.js';
import { useRuntime } from './useRuntime.js';
import { ShellTab } from './ShellTab.js';
import { ApiConsole } from './api-console/ApiConsole.js';
import { PreviewTab } from './PreviewTab.js';
import { Tabs, panelId, tabId, type TabDefinition } from '../ui/Tabs.js';

const TerminalView = lazy(() => import('./TerminalView.js'));

type RunTab = 'output' | 'shell' | 'api' | 'preview';

const RUN_TABS: readonly TabDefinition<RunTab>[] = [
  { id: 'output', label: 'Output' },
  { id: 'shell', label: 'Shell' },
  { id: 'api', label: 'API' },
  { id: 'preview', label: 'Preview' },
];

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
  /** Explain with AI, offered when the run stopped on an error. */
  onExplainError: (failure: RunFailure) => void;
};

export function RunPanel({
  session,
  onSyncError,
  onExplainError,
}: RunPanelProps): React.ReactElement {
  const { state, output, dependenciesChanged, run, stop, canOpenShell, shell, openShell, send } =
    useRuntime(session, onSyncError);
  const [tab, setTab] = useState<RunTab>('output');
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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <p
          role="status"
          aria-label="Run status"
          className={`min-w-0 flex-1 text-xs ${TONE_CLASS[status.tone]}`}
        >
          {status.text}
        </p>
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
        {runFailure(state, '') !== null && (
          <Button
            label="Explain with AI"
            onClick={() => {
              const failure = runFailure(state, output.recent(RAW_OUTPUT_CHARS));
              if (failure) onExplainError(failure);
            }}
          >
            <Sparkles className="size-3.5" aria-hidden />
          </Button>
        )}
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

      <Tabs label="Run views" tabs={RUN_TABS} selected={tab} onSelect={setTab} idPrefix="run" />
      {/* One panel per tab. The API console stays mounted so its form and
          history survive switching tabs; terminals remount and replay their
          output buffers. */}
      {RUN_TABS.map(({ id }) => (
        <div
          key={id}
          role="tabpanel"
          id={panelId('run', id)}
          aria-labelledby={tabId('run', id)}
          hidden={tab !== id}
          className="min-h-0 flex-1"
        >
          {id === 'output' &&
            tab === 'output' &&
            (hasRun ? (
              <Suspense
                fallback={<p className="p-3 text-xs text-zinc-500">Loading the terminal…</p>}
              >
                <TerminalView label="Run output" source={output} />
              </Suspense>
            ) : (
              <p className="p-3 text-xs text-zinc-500">
                Output appears here when you run the project.
              </p>
            ))}
          {id === 'shell' && tab === 'shell' && (
            <ShellTab shell={shell} canOpen={canOpenShell} onOpen={openShell} />
          )}
          {id === 'api' && <ApiConsole send={send} restarting={state.phase === 'restarting'} />}
          {id === 'preview' && tab === 'preview' && (
            <PreviewTab
              server={
                state.phase === 'serving' || state.phase === 'restarting' ? state.server : null
              }
              restarting={state.phase === 'restarting'}
            />
          )}
        </div>
      ))}
    </div>
  );
}
