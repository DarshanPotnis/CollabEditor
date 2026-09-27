/**
 * The runner for the current session. It is created and disposed in one
 * effect (StrictMode-safe); creating it is cheap, since the container boots on
 * the first Run. Leaving the workspace tears the container down.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSession } from '../../collab/useProject.js';
import { createOutputBuffer, type OutputBuffer } from './output-buffer.js';
import { createRunner, type Runner } from './process-runner.js';
import { IDLE, type RunState } from './run-state.js';
import { bootContainer, teardownContainer } from './webcontainer.js';

export type RuntimeControls = {
  state: RunState;
  output: OutputBuffer;
  dependenciesChanged: boolean;
  run: () => void;
  stop: () => void;
};

export function useRuntime(
  session: ProjectSession | null,
  onSyncError: (message: string) => void,
): RuntimeControls {
  const [state, setState] = useState<RunState>(IDLE);
  const [dependenciesChanged, setDependenciesChanged] = useState(false);
  const output = useMemo(() => createOutputBuffer(), []);
  const runner = useRef<Runner | null>(null);
  const reportSyncError = useRef(onSyncError);
  useEffect(() => {
    reportSyncError.current = onSyncError;
  }, [onSyncError]);

  useEffect(() => {
    if (!session) return;
    const created = createRunner({
      doc: session.doc,
      container: bootContainer,
      output,
      onState: setState,
      onDependenciesChanged: setDependenciesChanged,
      onSyncError: (path, error) => {
        const detail = error instanceof Error ? error.message : String(error);
        reportSyncError.current(
          path === null
            ? `The running project could not be updated: ${detail}`
            : `Could not update ${path} in the running project: ${detail}`,
        );
      },
      onInternalError: (error) => {
        // eslint-disable-next-line no-console -- there is no logging service; the browser console is all we have
        console.error('CollabCode runtime', error);
      },
    });
    runner.current = created;
    return () => {
      created.dispose();
      runner.current = null;
      teardownContainer();
      setState(IDLE);
      setDependenciesChanged(false);
    };
  }, [session, output]);

  const run = useCallback(() => void runner.current?.run(), []);
  const stop = useCallback(() => runner.current?.stop(), []);

  return { state, output, dependenciesChanged, run, stop };
}
