/**
 * An interactive shell in the running project's container. It only exists
 * once a run has booted the container and copied the project into it.
 */
import { lazy, Suspense } from 'react';
import type { ShellSession } from './shell-session.js';

const TerminalView = lazy(() => import('./TerminalView.js'));

export type ShellTabProps = {
  shell: ShellSession | null;
  canOpen: boolean;
  onOpen: () => void;
};

export function ShellTab({ shell, canOpen, onOpen }: ShellTabProps): React.ReactElement {
  if (shell) {
    return (
      <Suspense fallback={<p className="p-3 text-xs text-zinc-500">Loading the terminal…</p>}>
        <TerminalView
          label="Shell"
          source={shell.output}
          onInput={shell.write}
          onResize={shell.resize}
        />
      </Suspense>
    );
  }
  return (
    <div className="p-3 text-xs text-zinc-400">
      {canOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md border border-zinc-700 px-2.5 py-1 text-zinc-200 hover:border-zinc-500"
        >
          Open a shell
        </button>
      ) : (
        <p>Run the project first. The shell opens in the container it runs in.</p>
      )}
    </div>
  );
}
