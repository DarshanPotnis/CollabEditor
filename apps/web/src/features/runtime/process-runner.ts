/**
 * One person's run: boot the container, sync the project into it, install
 * when the dependencies changed, start the dev script, and follow its server
 * (PLAN.md §10.2). The lifecycle itself is run-state.ts; this drives it.
 *
 * Every run gets a generation number. Output, exits and awaited steps from an
 * older generation are dropped, so a Restart never reads the old process's
 * exit as a crash of the new one, and a Stop in the middle of an install
 * really stops.
 */
import type * as Y from 'yjs';
import { readFileContent, resolveDocTree } from '@collabcode/shared';
import type { Container, ContainerProcess } from './container.js';
import { createFsBridge, type FsBridge, type SyncResult } from './fs-bridge/fs-bridge.js';
import type { OutputSink } from './output-buffer.js';
import { watchForCrashes } from './watch-signals.js';
import { needsInstall, runPlan } from './run-script.js';
import {
  IDLE,
  RESTART_GRACE_MS,
  runReducer,
  shouldAutoRestart,
  type RunEvent,
  type RunState,
  type Server,
} from './run-state.js';

export type RunnerOptions = {
  doc: Y.Doc;
  container: () => Promise<Container>;
  output: OutputSink;
  onState: (state: RunState) => void;
  /** package.json's dependencies differ from what was last installed. */
  onDependenciesChanged: (changed: boolean) => void;
  onSyncError: (path: string | null, error: unknown) => void;
  /** Something unexpected, such as a broken output stream. */
  onInternalError: (error: unknown) => void;
  autoRestartDelayMs?: number;
};

export type Runner = {
  run: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
  state: () => RunState;
  /** The booted container, once a run has booted it. */
  container: () => Container | null;
  /**
   * The server, once it is listening: at once while serving, after a restart
   * or start-up finishes, or rejected with a ServerUnavailableError.
   */
  waitForServer: (timeoutMs?: number) => Promise<Server>;
  /** The state once `accept` holds for it, or null after `timeoutMs` or once `signal` stops. */
  whenState: (
    accept: (state: RunState) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<RunState | null>;
  /**
   * Writes to the container, now, whatever the document has that it lacks.
   * When that changed a file while the server was up, or after a crash (which
   * restarts on the next write), waits for the restart to finish, so what runs
   * next talks to the new code. Resolves with the state things settled in;
   * rejects with a SettleError when writing or restarting takes too long.
   */
  settle: (options?: SettleOptions) => Promise<RunState>;
};

export type SettleOptions = {
  writeMs?: number;
  noticeMs?: number;
  restartMs?: number;
  signal?: AbortSignal;
};

/** How long writing to the container may take before sync counts as delayed. */
export const SETTLE_WRITE_MS = 10_000;
/** How soon after a write a restart must begin to count as caused by it. */
export const RESTART_NOTICE_MS = 1_500;
/** How long a restart may take, npm install included. */
export const SETTLE_RESTART_MS = 60_000;

export class SettleError extends Error {
  readonly stage: 'write' | 'restart';

  constructor(stage: 'write' | 'restart', message: string) {
    super(message);
    this.name = 'SettleError';
    this.stage = stage;
  }
}

/** A state the run stays in until something happens: nothing is on its way. */
export function isSettled(state: RunState): boolean {
  switch (state.phase) {
    case 'serving':
    case 'crashed':
    case 'failed':
    case 'stopped':
    case 'idle':
      return true;
    default:
      return false;
  }
}

export const AUTO_RESTART_DELAY_MS = 500;
export const SERVER_WAIT_MS = 10_000;

export class ServerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerUnavailableError';
  }
}

/** Why there is no server to talk to, or null if one may still come. */
function unavailableReason(state: RunState): string | null {
  switch (state.phase) {
    case 'idle':
    case 'stopped':
      return "The project isn't running. Click Run first.";
    case 'failed':
      return `The run failed: ${state.message}`;
    case 'crashed':
      return 'The server is down because the program crashed. The run output says why.';
    default:
      return null;
  }
}

type Waiter = {
  resolve: (server: Server) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const dim = (text: string): string => `\x1b[2m${text}\x1b[0m\r\n`;

function packageJson(doc: Y.Doc): string | undefined {
  const id = resolveDocTree(doc).idByPath.get('package.json');
  return id === undefined ? undefined : readFileContent(doc, id);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRunner(options: RunnerOptions): Runner {
  const { doc, output } = options;
  let state: RunState = IDLE;
  let generation = 0;
  let container: Container | null = null;
  let bridge: FsBridge | null = null;
  let unsubscribePort: (() => void) | null = null;
  let installing: ContainerProcess | null = null;
  let dev: ContainerProcess | null = null;
  let installedKey: string | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let autoRestartTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  /** Syncs that changed the container, so settle() can tell whether a write happened. */
  let writes = 0;
  const waiters = new Set<Waiter>();
  const stateListeners = new Set<(state: RunState) => void>();

  const settleWaiters = (): void => {
    const reason = unavailableReason(state);
    for (const waiter of waiters) {
      if (state.phase === 'serving') waiter.resolve(state.server);
      else if (reason !== null) waiter.reject(new ServerUnavailableError(reason));
      else continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
    }
  };

  const dispatch = (event: RunEvent): void => {
    const previous = state;
    state = runReducer(state, event);
    if (state === previous) return;
    if (state.phase === 'restarting' && previous.phase !== 'restarting') {
      graceTimer = setTimeout(() => {
        graceTimer = null;
        dispatch({ type: 'restart-grace-expired' });
      }, RESTART_GRACE_MS);
    } else if (state.phase !== 'restarting' && graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    settleWaiters();
    for (const listener of [...stateListeners]) listener(state);
    options.onState(state);
  };

  const whenState = (
    accept: (candidate: RunState) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RunState | null> => {
    if (accept(state)) return Promise.resolve(state);
    return new Promise((resolve) => {
      const done = (result: RunState | null): void => {
        clearTimeout(timer);
        stateListeners.delete(listener);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const listener = (candidate: RunState): void => {
        if (accept(candidate)) done(candidate);
      };
      const onAbort = (): void => done(null);
      const timer = setTimeout(() => done(null), timeoutMs);
      stateListeners.add(listener);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  };

  /** Shows a process's output while it is current, and passes it to `read` as well. */
  const pipe = (child: ContainerProcess, owner: number, read?: (chunk: string) => void): void => {
    child.output
      .pipeTo(
        new WritableStream({
          write: (chunk) => {
            if (owner !== generation) return;
            output.write(chunk);
            read?.(chunk);
          },
        }),
      )
      .catch((error: unknown) => {
        if (owner === generation) options.onInternalError(error);
      });
  };

  const killProcesses = (): void => {
    const running = [installing, dev];
    installing = null;
    dev = null;
    for (const each of running) each?.kill();
  };

  const clearAutoRestart = (): void => {
    if (autoRestartTimer !== null) clearTimeout(autoRestartTimer);
    autoRestartTimer = null;
  };

  const checkDependencies = (): void => {
    const plan = runPlan(packageJson(doc));
    if (plan.kind === 'ready')
      options.onDependenciesChanged(plan.installKey !== (installedKey ?? ''));
  };

  const onSynced = (result: SyncResult): void => {
    writes += 1;
    if (result.written.includes('package.json')) checkDependencies();
    if (!shouldAutoRestart(state, result)) return;
    clearAutoRestart();
    autoRestartTimer = setTimeout(() => {
      autoRestartTimer = null;
      if (state.phase !== 'crashed') return;
      output.write(dim('A file changed after the crash, so the run is restarting.'));
      void run();
    }, options.autoRestartDelayMs ?? AUTO_RESTART_DELAY_MS);
  };

  const onPort = (port: number, type: 'open' | 'close', url: string): void => {
    if (disposed) return;
    dispatch(type === 'open' ? { type: 'port-opened', port, url } : { type: 'port-closed', port });
  };

  const run = async (): Promise<void> => {
    if (disposed) return;
    generation += 1;
    const owner = generation;
    const current = (): boolean => owner === generation && !disposed;
    clearAutoRestart();
    killProcesses();
    dispatch({ type: 'run' });

    let booted: Container;
    try {
      booted = container ?? (await options.container());
    } catch (error) {
      if (current()) dispatch({ type: 'failed', message: messageOf(error) });
      return;
    }
    if (!current()) return;
    container = booted;
    dispatch({ type: 'booted' });

    if (bridge) {
      await bridge.flush();
    } else {
      bridge = createFsBridge({ doc, fs: booted.fs, onError: options.onSyncError, onSynced });
      unsubscribePort = booted.onPort(onPort);
      await bridge.start();
    }
    if (!current()) return;
    dispatch({ type: 'synced' });

    const plan = runPlan(packageJson(doc));
    if (plan.kind === 'problem') {
      dispatch({ type: 'failed', message: plan.message });
      return;
    }

    if (needsInstall(plan.installKey, installedKey)) {
      output.write(dim('$ npm install'));
      const install = await booted.spawn('npm', ['install']);
      if (!current()) {
        install.kill();
        return;
      }
      installing = install;
      pipe(install, owner);
      const code = await install.exit;
      if (!current()) return;
      installing = null;
      if (code !== 0) {
        dispatch({
          type: 'failed',
          message: `npm install exited with code ${String(code)}. The output above says why.`,
        });
        return;
      }
      installedKey = plan.installKey;
      options.onDependenciesChanged(false);
    }

    output.write(dim(`$ npm ${plan.args.join(' ')}`));
    const devProcess = await booted.spawn('npm', plan.args);
    if (!current()) {
      devProcess.kill();
      return;
    }
    dev = devProcess;
    pipe(
      devProcess,
      owner,
      watchForCrashes(() => {
        if (dev === devProcess) dispatch({ type: 'watch-failed' });
      }),
    );
    dispatch({ type: 'dev-started', script: plan.script });
    void devProcess.exit.then((exitCode) => {
      if (dev !== devProcess) return;
      dev = null;
      output.write(dim(`The dev process exited with code ${String(exitCode)}.`));
      dispatch({ type: 'dev-exited', exitCode });
    });
  };

  const stop = (): void => {
    generation += 1;
    clearAutoRestart();
    killProcesses();
    dispatch({ type: 'stop' });
  };

  return {
    run,
    stop,
    dispose() {
      stop();
      disposed = true;
      bridge?.stop();
      unsubscribePort?.();
      if (graceTimer !== null) clearTimeout(graceTimer);
    },
    state: () => state,
    container: () => container,
    whenState,
    async settle({
      writeMs = SETTLE_WRITE_MS,
      noticeMs = RESTART_NOTICE_MS,
      restartMs = SETTLE_RESTART_MS,
      signal,
    } = {}) {
      if (!bridge) return state;
      const before = state;
      const writesBefore = writes;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const written = await Promise.race([
        bridge.flush().then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), writeMs);
        }),
      ]);
      clearTimeout(timer);
      if (!written) {
        throw new SettleError(
          'write',
          `The latest changes took more than ${String(writeMs / 1000)} seconds to reach the running project.`,
        );
      }
      const mayRestart =
        writes !== writesBefore && (before.phase === 'serving' || autoRestartTimer !== null);
      if (!mayRestart) return state;
      const restarting = await whenState(
        (candidate) => candidate.phase !== before.phase,
        noticeMs,
        signal,
      );
      if (restarting === null) return state;
      const settled = await whenState(isSettled, restartMs, signal);
      if (settled === null && !signal?.aborted) {
        throw new SettleError(
          'restart',
          `The project did not finish restarting within ${String(restartMs / 1000)} seconds.`,
        );
      }
      return state;
    },
    waitForServer(timeoutMs = SERVER_WAIT_MS) {
      if (state.phase === 'serving') return Promise.resolve(state.server);
      const reason = unavailableReason(state);
      if (reason !== null) return Promise.reject(new ServerUnavailableError(reason));
      return new Promise<Server>((resolve, reject) => {
        const waiter: Waiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new ServerUnavailableError(
                `No server started listening within ${String(timeoutMs / 1000)} seconds. The run output says what the program is doing.`,
              ),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}
