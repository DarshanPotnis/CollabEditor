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
import { needsInstall, runPlan } from './run-script.js';
import {
  IDLE,
  RESTART_GRACE_MS,
  runReducer,
  shouldAutoRestart,
  type RunEvent,
  type RunState,
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
};

export const AUTO_RESTART_DELAY_MS = 500;

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
    options.onState(state);
  };

  const pipe = (child: ContainerProcess, owner: number): void => {
    child.output
      .pipeTo(
        new WritableStream({
          write: (chunk) => {
            if (owner === generation) output.write(chunk);
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
    pipe(devProcess, owner);
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
  };
}
