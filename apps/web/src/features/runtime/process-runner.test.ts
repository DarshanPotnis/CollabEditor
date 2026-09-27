import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  initProjectDoc,
  readFileText,
  resolveDocTree,
  restore,
  softDelete,
  type TemplateId,
} from '@collabcode/shared';
import { FakeContainer } from '../../test/fake-container.js';
import { createOutputBuffer } from './output-buffer.js';
import {
  AUTO_RESTART_DELAY_MS,
  SERVER_WAIT_MS,
  ServerUnavailableError,
  createRunner,
  type Runner,
} from './process-runner.js';
import { RESTART_GRACE_MS, type RunState } from './run-state.js';

const ada = { userId: 'ada', userName: 'Ada' };
const runners: Runner[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.useRealTimers();
});

function project(template: TemplateId = 'express-api'): Y.Doc {
  const doc = new Y.Doc();
  initProjectDoc(doc, { name: 'P', template });
  return doc;
}

function idOf(doc: Y.Doc, path: string): string {
  const id = resolveDocTree(doc).idByPath.get(path);
  if (id === undefined) throw new Error(`no ${path}`);
  return id;
}

function setup(doc = project(), boot?: () => Promise<FakeContainer>) {
  const container = new FakeContainer();
  const states: RunState[] = [];
  const dependencyNotices: boolean[] = [];
  const output = createOutputBuffer();
  let text = '';
  output.attach({ write: (chunk) => (text += chunk) });
  const runner = createRunner({
    doc,
    container: boot ?? (() => Promise.resolve(container)),
    output,
    onState: (state) => states.push(state),
    onDependenciesChanged: (changed) => dependencyNotices.push(changed),
    onSyncError: (path, error) => {
      throw new Error(`unexpected sync error at ${String(path)}: ${String(error)}`);
    },
    onInternalError: (error) => {
      throw error;
    },
  });
  runners.push(runner);
  return { doc, container, runner, states, dependencyNotices, output: () => text };
}

/** Let the bridge's quiet period and any follow-up timers run. */
async function settle(ms = 1_500): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('process runner', () => {
  it('syncs the project, installs, starts the dev script, and follows its server', async () => {
    const { container, runner, states, output } = setup();
    await runner.run();

    expect(container.fs.paths()).toEqual(['index.js', 'package.json', 'routes/users.js']);
    expect(container.commandLines()).toEqual(['npm install', 'npm run dev']);
    expect(states.map((state) => state.phase)).toEqual([
      'booting',
      'syncing',
      'installing',
      'starting',
    ]);
    expect(output()).toContain('added 64 packages');

    container.emitPort(3000, 'open');
    expect(runner.state()).toEqual({
      phase: 'serving',
      script: 'dev',
      server: { port: 3000, url: 'https://p-3000.example' },
    });
  });

  it('skips npm install for a project with no dependencies', async () => {
    const { container, runner } = setup(project('blank-node'));
    await runner.run();
    expect(container.commandLines()).toEqual(['npm run dev']);
  });

  it('does not reinstall on Restart when the dependencies are unchanged', async () => {
    const { container, runner } = setup();
    await runner.run();
    await runner.run();
    expect(container.commandLines()).toEqual(['npm install', 'npm run dev', 'npm run dev']);
    expect(container.processes[1]?.killed).toBe(true);
  });

  it("does not read the old dev process's exit on Restart as a crash", async () => {
    const { container, runner } = setup();
    await runner.run();
    await runner.run();
    container.emitPort(3000, 'open');
    await settle();
    expect(runner.state().phase).toBe('serving');
  });

  it('fails with the exit code when npm install fails, and does not start', async () => {
    const { container, runner } = setup();
    container.installExitCode = 1;
    await runner.run();
    expect(runner.state()).toEqual({
      phase: 'failed',
      message: 'npm install exited with code 1. The output above says why.',
    });
    expect(container.commandLines()).toEqual(['npm install']);
  });

  it('explains a missing package.json instead of starting', async () => {
    const doc = project();
    softDelete(doc, idOf(doc, 'package.json'), ada);
    const { container, runner } = setup(doc);
    await runner.run();
    expect(runner.state()).toMatchObject({
      phase: 'failed',
      message: expect.stringMatching(/no package\.json/) as unknown,
    });
    expect(container.commandLines()).toEqual([]);
  });

  it('reports a runtime that could not boot', async () => {
    const { runner } = setup(project(), () =>
      Promise.reject(new Error('The runtime could not start')),
    );
    await runner.run();
    expect(runner.state()).toEqual({ phase: 'failed', message: 'The runtime could not start' });
  });

  it('stops the dev process and ignores its late exit', async () => {
    const { container, runner } = setup();
    await runner.run();
    runner.stop();
    expect(container.last('npm run dev').killed).toBe(true);
    await settle();
    expect(runner.state()).toEqual({ phase: 'stopped' });
  });

  it('a Stop during npm install kills it and starts nothing', async () => {
    const { container, runner } = setup();
    container.installExitCode = null;
    const running = runner.run();
    await settle(0);
    const install = container.last('npm install');
    expect(runner.state().phase).toBe('installing');

    runner.stop();
    await running;
    await settle();
    expect(install.killed).toBe(true);
    expect(container.commandLines()).toEqual(['npm install']);
    expect(runner.state()).toEqual({ phase: 'stopped' });
  });

  it('keeps a healthy server running while files change; node --watch restarts it', async () => {
    const { doc, container, runner } = setup();
    await runner.run();
    container.emitPort(3000, 'open');
    readFileText(doc, idOf(doc, 'routes/users.js'))?.insert(0, '// edit\n');
    await settle();
    expect(container.commandLines()).toEqual(['npm install', 'npm run dev']);
    expect(container.fs.files.get('routes/users.js')).toMatch(/^\/\/ edit/);
  });

  it('a server that closes and reopens within the grace period is restarting, not crashed', async () => {
    const { container, runner } = setup();
    await runner.run();
    container.emitPort(3000, 'open');
    container.emitPort(3000, 'close');
    expect(runner.state().phase).toBe('restarting');
    container.emitPort(3000, 'open');
    await settle(RESTART_GRACE_MS * 2);
    expect(runner.state().phase).toBe('serving');
  });

  describe('auto-restart after a crash', () => {
    it('restarts when the dev process exited and a file is then synced', async () => {
      const { doc, container, runner, output } = setup();
      await runner.run();
      container.last('npm run dev').finish(1);
      await settle(0);
      expect(runner.state()).toMatchObject({ phase: 'crashed', reason: 'exited', exitCode: 1 });

      readFileText(doc, idOf(doc, 'index.js'))?.insert(0, '// fixed\n');
      await settle();
      expect(container.commandLines()).toEqual(['npm install', 'npm run dev', 'npm run dev']);
      expect(runner.state().phase).toBe('starting');
      expect(output()).toContain('the run is restarting');
    });

    it('restarts when the server stopped listening and a deleted file is restored', async () => {
      const { doc, container, runner } = setup();
      await runner.run();
      container.emitPort(3000, 'open');
      const users = idOf(doc, 'routes/users.js');

      // Deleting the route crashes the server; node --watch then waits.
      softDelete(doc, users, ada);
      await settle(300);
      container.emitPort(3000, 'close');
      await settle(RESTART_GRACE_MS);
      expect(runner.state()).toMatchObject({ phase: 'crashed', reason: 'stopped-listening' });

      // node --watch would not notice the file coming back; the runner does.
      restore(doc, users);
      await settle(300 + AUTO_RESTART_DELAY_MS);
      expect(container.fs.files.has('routes/users.js')).toBe(true);
      expect(container.commandLines().filter((line) => line === 'npm run dev')).toHaveLength(2);
    });

    it('waits for edits to settle instead of restarting on every keystroke', async () => {
      const { doc, container, runner } = setup();
      await runner.run();
      container.last('npm run dev').finish(1);
      await settle(0);
      const text = readFileText(doc, idOf(doc, 'index.js'));
      for (const char of 'abc') {
        text?.insert(0, char);
        await settle(100);
      }
      await settle();
      expect(container.commandLines().filter((line) => line === 'npm run dev')).toHaveLength(2);
    });

    it('does not restart a run the person stopped', async () => {
      const { doc, container, runner } = setup();
      await runner.run();
      runner.stop();
      readFileText(doc, idOf(doc, 'index.js'))?.insert(0, 'x');
      await settle();
      expect(container.commandLines()).toEqual(['npm install', 'npm run dev']);
    });
  });

  it('says when package.json dependencies changed since the install', async () => {
    const { doc, runner, dependencyNotices } = setup();
    await runner.run();
    const pkg = readFileText(doc, idOf(doc, 'package.json'));
    const content = pkg?.toJSON() ?? '';
    pkg?.delete(0, content.length);
    pkg?.insert(
      0,
      content.replace('"express": "^5.2.1"', '"express": "^5.2.1",\n    "zod": "^4.0.0"'),
    );
    await settle();
    expect(dependencyNotices.at(-1)).toBe(true);

    await runner.run();
    expect(dependencyNotices.at(-1)).toBe(false);
  });

  it('drops output from a process it has replaced, but shows the new one', async () => {
    const { container, runner, output } = setup();
    await runner.run();
    const old = container.last('npm run dev');
    await runner.run();
    expect(old.killed).toBe(true);

    old.print('stale line\r\n');
    container.last('npm run dev').print('fresh line\r\n');
    await settle(0);
    expect(output()).not.toContain('stale line');
    expect(output()).toContain('fresh line');
  });

  describe('waitForServer', () => {
    it('returns the server at once while serving', async () => {
      const { container, runner } = setup();
      await runner.run();
      container.emitPort(3000, 'open');
      await expect(runner.waitForServer()).resolves.toEqual({
        port: 3000,
        url: 'https://p-3000.example',
      });
    });

    it('waits out a restart', async () => {
      const { container, runner } = setup();
      await runner.run();
      container.emitPort(3000, 'open');
      container.emitPort(3000, 'close');
      const waiting = runner.waitForServer();
      container.emitPort(3000, 'open');
      await expect(waiting).resolves.toMatchObject({ port: 3000 });
    });

    it('gives up when no server starts listening in time', async () => {
      const { runner } = setup();
      await runner.run();
      const waiting = runner.waitForServer();
      const assertion = expect(waiting).rejects.toThrow(
        /No server started listening within 10 seconds/,
      );
      await settle(SERVER_WAIT_MS);
      await assertion;
    });

    it('fails at once, saying why, when there is nothing to wait for', async () => {
      const { runner, container } = setup();
      await expect(runner.waitForServer()).rejects.toThrow(
        "The project isn't running. Click Run first.",
      );
      await runner.run();
      container.last('npm run dev').finish(1);
      await settle(0);
      await expect(runner.waitForServer()).rejects.toBeInstanceOf(ServerUnavailableError);
    });

    it('fails a waiting request when the run crashes', async () => {
      const { container, runner } = setup();
      await runner.run();
      const waiting = runner.waitForServer();
      container.last('npm run dev').finish(1);
      await expect(waiting).rejects.toThrow(/crashed/);
    });
  });
});
