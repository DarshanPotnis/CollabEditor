/**
 * The lifecycle of one person's run, as a pure reducer (PLAN.md §10.2).
 *
 *   idle ─Run─► booting ─► syncing ─► installing ─► starting ─► serving
 *                                                      ▲    ▲      │ port closed
 *                                  a file is synced ──┐│    │      ▼
 *                                                     crashed ◄─ restarting
 *                                                        ▲   (no port within the grace period)
 *                                   dev process exits ───┘
 *
 * The runner must drop events from processes it has already replaced (a
 * Restart kills the old dev process, whose exit would otherwise read as a
 * crash of the new one).
 *
 * "Crashed" covers both ways a run dies: the dev process exits on its own, or
 * a server that was listening stops and does not come back (`node --watch`
 * waiting for changes after an error). From there the next synced file
 * restarts the run (shouldAutoRestart). "Failed" is for problems a file change
 * cannot fix by itself: booting, a missing script, a failed install.
 */
import type { RunScript } from './run-script.js';

export type Server = { port: number; url: string };

export type RunState =
  | { phase: 'idle' }
  | { phase: 'booting' }
  | { phase: 'syncing' }
  | { phase: 'installing' }
  | { phase: 'starting'; script: RunScript }
  | { phase: 'serving'; script: RunScript; server: Server }
  | { phase: 'restarting'; script: RunScript; server: Server }
  | { phase: 'crashed'; script: RunScript; reason: 'exited'; exitCode: number }
  | { phase: 'crashed'; script: RunScript; reason: 'stopped-listening' }
  | { phase: 'stopped' }
  | { phase: 'failed'; message: string };

export type RunEvent =
  | { type: 'run' }
  | { type: 'booted' }
  | { type: 'synced' }
  | { type: 'dev-started'; script: RunScript }
  | { type: 'port-opened'; port: number; url: string }
  | { type: 'port-closed'; port: number }
  | { type: 'restart-grace-expired' }
  | { type: 'dev-exited'; exitCode: number }
  | { type: 'stop' }
  | { type: 'failed'; message: string };

export const IDLE: RunState = { phase: 'idle' };

/** How long a server may be gone before a restart counts as a crash. */
export const RESTART_GRACE_MS = 3_000;

/** Whether the Run button (rather than Stop and Restart) is what makes sense. */
export function canRun(state: RunState): boolean {
  return state.phase === 'idle' || state.phase === 'stopped' || state.phase === 'failed';
}

export function runReducer(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'run':
      // Run, Restart and an automatic restart all start from the top; the
      // runner skips steps that are already done (booting, installing).
      return { phase: 'booting' };
    case 'booted':
      return state.phase === 'booting' ? { phase: 'syncing' } : state;
    case 'synced':
      return state.phase === 'syncing' ? { phase: 'installing' } : state;
    case 'dev-started':
      return isPreparing(state) ? { phase: 'starting', script: event.script } : state;
    case 'port-opened':
      if (!hasScript(state)) return state;
      return {
        phase: 'serving',
        script: state.script,
        server: { port: event.port, url: event.url },
      };
    case 'port-closed':
      return state.phase === 'serving' && state.server.port === event.port
        ? { phase: 'restarting', script: state.script, server: state.server }
        : state;
    case 'restart-grace-expired':
      return state.phase === 'restarting'
        ? { phase: 'crashed', script: state.script, reason: 'stopped-listening' }
        : state;
    case 'dev-exited':
      return hasScript(state)
        ? { phase: 'crashed', script: state.script, reason: 'exited', exitCode: event.exitCode }
        : state;
    case 'stop':
      return state.phase === 'idle' ? state : { phase: 'stopped' };
    case 'failed':
      return { phase: 'failed', message: event.message };
  }
}

function isPreparing(state: RunState): boolean {
  return state.phase === 'booting' || state.phase === 'syncing' || state.phase === 'installing';
}

function hasScript(state: RunState): state is Extract<RunState, { script: RunScript }> {
  return (
    state.phase === 'starting' ||
    state.phase === 'serving' ||
    state.phase === 'restarting' ||
    state.phase === 'crashed'
  );
}

/** A run is in progress (Stop and Restart apply). */
export function isActive(state: RunState): boolean {
  return isPreparing(state) || hasScript(state);
}

/**
 * Whether a sync should restart the run: only after a crash, and only when
 * the sync actually changed a file. This covers what `node --watch` cannot:
 * after a crash it watches only the files it had loaded, so restoring a
 * deleted file, or creating a missing one, would otherwise need a manual
 * Restart.
 */
export function shouldAutoRestart(
  state: RunState,
  sync: { written: readonly string[]; removed: readonly string[] },
): boolean {
  return state.phase === 'crashed' && sync.written.length + sync.removed.length > 0;
}
