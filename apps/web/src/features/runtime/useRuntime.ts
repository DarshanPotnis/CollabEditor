/**
 * The runner for the current session. It is created and disposed in one
 * effect (StrictMode-safe); creating it is cheap, since the container boots on
 * the first Run. Leaving the workspace tears the container down.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSession } from '../../collab/useProject.js';
import { createOutputBuffer, type OutputBuffer } from './output-buffer.js';
import type { ApiRequest, ApiResult } from './api-console/request-codec.js';
import { sendRequest } from './api-console/send-request.js';
import { ServerUnavailableError, createRunner, type Runner } from './process-runner.js';
import { IDLE, type RunState } from './run-state.js';
import { startShell, type ShellSession } from './shell-session.js';
import { bootContainer, teardownContainer } from './webcontainer.js';

export type RuntimeControls = {
  state: RunState;
  output: OutputBuffer;
  dependenciesChanged: boolean;
  run: () => void;
  stop: () => void;
  /** Whether a container exists for a shell to run in. */
  canOpenShell: boolean;
  shell: ShellSession | null;
  openShell: () => void;
  /** Send an API console request to the running server, waiting out a restart. */
  send: (request: ApiRequest) => Promise<ConsoleResult>;
};

export type ConsoleResult = ApiResult | { kind: 'unavailable'; message: string };

function reportInternalError(error: unknown): void {
  // eslint-disable-next-line no-console -- there is no logging service; the browser console is all we have
  console.error('CollabCode runtime', error);
}

export function useRuntime(
  session: ProjectSession | null,
  onSyncError: (message: string) => void,
): RuntimeControls {
  const [state, setState] = useState<RunState>(IDLE);
  const [dependenciesChanged, setDependenciesChanged] = useState(false);
  const output = useMemo(() => createOutputBuffer(), []);
  const runner = useRef<Runner | null>(null);
  const [shell, setShell] = useState<ShellSession | null>(null);
  const shellRef = useRef<ShellSession | null>(null);
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
      onInternalError: reportInternalError,
    });
    runner.current = created;
    return () => {
      shellRef.current?.dispose();
      shellRef.current = null;
      setShell(null);
      created.dispose();
      runner.current = null;
      teardownContainer();
      setState(IDLE);
      setDependenciesChanged(false);
    };
  }, [session, output]);

  const run = useCallback(() => void runner.current?.run(), []);
  const stop = useCallback(() => runner.current?.stop(), []);

  const openShell = useCallback(() => {
    const container = runner.current?.container();
    if (!container || shellRef.current) return;
    startShell(container, reportInternalError).then((started) => {
      shellRef.current = started;
      setShell(started);
      void started.exited.then(() => {
        if (shellRef.current !== started) return;
        shellRef.current = null;
        setShell(null);
      });
    }, reportInternalError);
  }, []);

  const send = useCallback(async (request: ApiRequest): Promise<ConsoleResult> => {
    const current = runner.current;
    const container = current?.container();
    if (!current || !container) {
      return { kind: 'unavailable', message: "The project isn't running. Click Run first." };
    }
    try {
      const server = await current.waitForServer();
      return await sendRequest(container, server.port, request);
    } catch (error) {
      if (error instanceof ServerUnavailableError)
        return { kind: 'unavailable', message: error.message };
      throw error;
    }
  }, []);

  // A container exists once a run has got past booting.
  const canOpenShell =
    state.phase !== 'idle' && state.phase !== 'booting' && Boolean(runner.current?.container());

  return { state, output, dependenciesChanged, run, stop, canOpenShell, shell, openShell, send };
}
