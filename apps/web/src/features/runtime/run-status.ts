/** What the Run panel says about the current run. */
import type { RunState } from './run-state.js';

export type RunStatus = { text: string; tone: 'idle' | 'busy' | 'ok' | 'error' };

const RECOVERY = 'Fix the error; the run restarts when a file changes.';

function crashSummary(state: Extract<RunState, { phase: 'crashed' }>): string {
  switch (state.reason) {
    case 'exited':
      return `The program exited with code ${String(state.exitCode)}.`;
    case 'stopped-listening':
      return 'The server stopped.';
    case 'watch-failed':
      return 'The program crashed.';
  }
}

export function runStatus(state: RunState): RunStatus {
  switch (state.phase) {
    case 'idle':
      return { text: 'Not running', tone: 'idle' };
    case 'booting':
      return { text: 'Starting the runtime…', tone: 'busy' };
    case 'syncing':
      return { text: 'Copying the project…', tone: 'busy' };
    case 'installing':
      return { text: 'Installing dependencies…', tone: 'busy' };
    case 'starting':
      return {
        text: `Running npm ${state.script === 'dev' ? 'run dev' : 'start'}; no server is listening yet`,
        tone: 'busy',
      };
    case 'serving':
      return { text: `Server running on port ${String(state.server.port)}`, tone: 'ok' };
    case 'restarting':
      return { text: 'Restarting after a change…', tone: 'busy' };
    case 'crashed':
      return { text: `${crashSummary(state)} ${RECOVERY}`, tone: 'error' };
    case 'stopped':
      return { text: 'Stopped', tone: 'idle' };
    case 'failed':
      return { text: state.message, tone: 'error' };
  }
}
