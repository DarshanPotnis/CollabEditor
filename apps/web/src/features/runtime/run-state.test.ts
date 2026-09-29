import { describe, expect, it } from 'vitest';
import {
  IDLE,
  canRun,
  isActive,
  runReducer,
  shouldAutoRestart,
  type RunEvent,
  type RunState,
} from './run-state.js';

function after(events: RunEvent[], from: RunState = IDLE): RunState {
  return events.reduce(runReducer, from);
}

const toServing: RunEvent[] = [
  { type: 'run' },
  { type: 'booted' },
  { type: 'synced' },
  { type: 'dev-started', script: 'dev' },
  { type: 'port-opened', port: 3000, url: 'https://p-3000.example' },
];
const serving = after(toServing);

describe('runReducer', () => {
  it('goes from idle to serving', () => {
    expect(after(toServing.slice(0, 1)).phase).toBe('booting');
    expect(after(toServing.slice(0, 3)).phase).toBe('installing');
    expect(after(toServing.slice(0, 4))).toEqual({ phase: 'starting', script: 'dev' });
    expect(serving).toEqual({
      phase: 'serving',
      script: 'dev',
      server: { port: 3000, url: 'https://p-3000.example' },
    });
  });

  it('treats a closed port as a restart, and a reopened one as serving again', () => {
    const restarting = runReducer(serving, { type: 'port-closed', port: 3000 });
    expect(restarting.phase).toBe('restarting');
    expect(runReducer(restarting, { type: 'port-opened', port: 3000, url: 'u' }).phase).toBe(
      'serving',
    );
  });

  it('ignores another port closing', () => {
    expect(runReducer(serving, { type: 'port-closed', port: 9229 })).toBe(serving);
  });

  it('calls it a crash when the server does not come back within the grace period', () => {
    const crashed = after(
      [{ type: 'port-closed', port: 3000 }, { type: 'restart-grace-expired' }],
      serving,
    );
    expect(crashed).toEqual({ phase: 'crashed', script: 'dev', reason: 'stopped-listening' });
  });

  it('ignores a grace timer that fires after the server came back', () => {
    const back = after(
      [
        { type: 'port-closed', port: 3000 },
        { type: 'port-opened', port: 3000, url: 'u' },
      ],
      serving,
    );
    expect(runReducer(back, { type: 'restart-grace-expired' })).toBe(back);
  });

  describe('when the watcher reports a crash', () => {
    const crashed = { phase: 'crashed', script: 'dev', reason: 'watch-failed' } as const;

    it('is a crash even though the server never listened', () => {
      const starting = after(toServing.slice(0, 4));
      expect(runReducer(starting, { type: 'watch-failed' })).toEqual(crashed);
    });

    it('is a crash at once, without waiting out the grace period', () => {
      expect(runReducer(serving, { type: 'watch-failed' })).toEqual(crashed);
      const restarting = runReducer(serving, { type: 'port-closed', port: 3000 });
      expect(runReducer(restarting, { type: 'watch-failed' })).toEqual(crashed);
    });

    it('names the crash when the report comes after the grace period ran out', () => {
      const stopped = after(
        [{ type: 'port-closed', port: 3000 }, { type: 'restart-grace-expired' }],
        serving,
      );
      expect(runReducer(stopped, { type: 'watch-failed' })).toEqual(crashed);
    });

    it('keeps the exit code of a dev process that exited', () => {
      const exited = runReducer(serving, { type: 'dev-exited', exitCode: 1 });
      expect(runReducer(exited, { type: 'watch-failed' })).toBe(exited);
    });

    it('changes nothing when no dev script is running', () => {
      for (const state of [IDLE, { phase: 'stopped' } as const, crashed]) {
        expect(runReducer(state, { type: 'watch-failed' })).toBe(state);
      }
    });

    it('restarts on the next synced change, like any crash', () => {
      expect(shouldAutoRestart(crashed, { written: ['index.js'], removed: [] })).toBe(true);
    });

    it('serves again when the watcher restarts the program and it listens', () => {
      expect(runReducer(crashed, { type: 'port-opened', port: 3000, url: 'u' })).toMatchObject({
        phase: 'serving',
      });
    });
  });

  it('calls it a crash when the dev process exits on its own', () => {
    expect(runReducer(serving, { type: 'dev-exited', exitCode: 1 })).toEqual({
      phase: 'crashed',
      script: 'dev',
      reason: 'exited',
      exitCode: 1,
    });
  });

  it('a program that never listens stays starting, not crashed', () => {
    expect(after(toServing.slice(0, 4)).phase).toBe('starting');
  });

  it('stop wins, and late events from the stopped run are ignored', () => {
    const stopped = runReducer(serving, { type: 'stop' });
    expect(stopped).toEqual({ phase: 'stopped' });
    expect(runReducer(stopped, { type: 'dev-exited', exitCode: 143 })).toBe(stopped);
    expect(runReducer(stopped, { type: 'port-opened', port: 3000, url: 'u' })).toBe(stopped);
  });

  it('records a failure from any step', () => {
    expect(
      runReducer(after(toServing.slice(0, 3)), {
        type: 'failed',
        message: 'npm install exited with code 1',
      }),
    ).toEqual({
      phase: 'failed',
      message: 'npm install exited with code 1',
    });
  });

  it('restarts from the top, from any state', () => {
    for (const state of [serving, IDLE, { phase: 'stopped' } as const]) {
      expect(runReducer(state, { type: 'run' })).toEqual({ phase: 'booting' });
    }
  });

  it('ignores out-of-order events', () => {
    expect(runReducer(IDLE, { type: 'booted' })).toBe(IDLE);
    expect(runReducer(IDLE, { type: 'dev-started', script: 'dev' })).toBe(IDLE);
    expect(runReducer(IDLE, { type: 'stop' })).toBe(IDLE);
  });
});

describe('canRun and isActive', () => {
  it('offer Run when nothing is running, and Stop/Restart otherwise', () => {
    expect(
      [IDLE, { phase: 'stopped' }, { phase: 'failed', message: 'x' }].every((s) =>
        canRun(s as RunState),
      ),
    ).toBe(true);
    expect(canRun(serving)).toBe(false);
    expect(isActive(serving)).toBe(true);
    expect(isActive(IDLE)).toBe(false);
  });
});

describe('shouldAutoRestart', () => {
  const crashed = after([{ type: 'dev-exited', exitCode: 1 }], serving);
  const wrote = { written: ['routes/users.js'], removed: [] };

  it('restarts a crashed run when a file is synced', () => {
    expect(shouldAutoRestart(crashed, wrote)).toBe(true);
    expect(shouldAutoRestart(crashed, { written: [], removed: ['old.js'] })).toBe(true);
  });

  it('leaves a healthy, stopped or failed run alone, and ignores empty syncs', () => {
    expect(shouldAutoRestart(serving, wrote)).toBe(false);
    expect(shouldAutoRestart({ phase: 'stopped' }, wrote)).toBe(false);
    expect(shouldAutoRestart({ phase: 'failed', message: 'x' }, wrote)).toBe(false);
    expect(shouldAutoRestart(crashed, { written: [], removed: [] })).toBe(false);
  });
});
