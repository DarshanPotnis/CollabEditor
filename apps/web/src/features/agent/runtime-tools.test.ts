import { createStopSource, type RuntimeToolCall } from '@collabcode/agent';
import { initProjectDoc, readFileText, resolveDocTree } from '@collabcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FakeContainer } from '../../test/fake-container.js';
import type { ApiRequest, ApiResult } from '../runtime/api-console/request-codec.js';
import { createOutputBuffer } from '../runtime/output-buffer.js';
import { SETTLE_WRITE_MS, createRunner, type Runner } from '../runtime/process-runner.js';
import {
  COMMAND_TIMEOUT_MS,
  OUTPUT_GRACE_MS,
  SYNC_DELAYED,
  createRuntimeTools,
  sandboxUnavailable,
} from './runtime-tools.js';

const runners: Runner[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.useRealTimers();
});

function response(status: number, body: string): ApiResult {
  return {
    kind: 'response',
    response: {
      status,
      statusText: status === 204 ? 'No Content' : status >= 500 ? 'Internal Server Error' : 'OK',
      headers: [['content-type', 'application/json']],
      body: new TextEncoder().encode(body),
      size: body.length,
      truncated: false,
      ms: 12,
    },
  };
}

function setup({
  docSynced = true,
  bootFails = null,
  sandboxProblem = null,
}: { docSynced?: boolean; bootFails?: string | null; sandboxProblem?: string | null } = {}) {
  const doc = new Y.Doc();
  initProjectDoc(doc, { name: 'P', template: 'express-api' });
  const container = new FakeContainer();
  const output = createOutputBuffer();
  let boots = 0;
  const runner = createRunner({
    doc,
    container: () => {
      boots += 1;
      return bootFails === null ? Promise.resolve(container) : Promise.reject(new Error(bootFails));
    },
    output,
    onState: () => undefined,
    onDependenciesChanged: () => undefined,
    onSyncError: (path, error) => {
      throw new Error(`sync error at ${String(path)}: ${String(error)}`);
    },
    onInternalError: (error) => {
      throw error;
    },
  });
  runners.push(runner);
  const notices: string[] = [];
  const requests: Array<{ port: number; request: ApiRequest; atState: string }> = [];
  let reply = response(200, '[]');
  const tools = createRuntimeTools({
    runtime: { ...runner, output },
    docSynced: () => Promise.resolve(docSynced),
    sendRequest: (_container, port, request) => {
      requests.push({ port, request, atState: runner.state().phase });
      return Promise.resolve(reply);
    },
    onNotice: (message) => notices.push(message),
    sandboxProblem,
    now: () => Date.now(),
  });
  const stop = createStopSource();
  const call = (tool: RuntimeToolCall) => tools.execute(tool, stop.signal);
  const edit = (path: string): void => {
    const id = resolveDocTree(doc).idByPath.get(path) ?? '';
    readFileText(doc, id)?.insert(0, '// edit\n');
  };
  const serving = async (): Promise<void> => {
    const started = call({ name: 'run_project', input: {} });
    await vi.advanceTimersByTimeAsync(10);
    container.emitPort(3000, 'open');
    await started;
  };
  return {
    container,
    runner,
    boots: () => boots,
    notices,
    requests,
    stop,
    call,
    edit,
    serving,
    reply: (next: ApiResult) => (reply = next),
  };
}

describe('run_project', () => {
  it('starts the project and says it is serving, with the recent output', async () => {
    const { call, container } = setup();
    const result = call({ name: 'run_project', input: {} });
    await vi.advanceTimersByTimeAsync(10);
    container.last('npm run dev').print('API listening on http://localhost:3000\r\n');
    container.emitPort(3000, 'open');
    const { ok, output } = await result;
    expect(ok).toBe(true);
    expect(output).toMatch(
      /^The project is running and serving on port 3000\.\n\nRecent output:\n/,
    );
    expect(output).toContain('API listening on http://localhost:3000');
  });

  it('gives the model the output without npm-style spinner frames', async () => {
    const { call, container } = setup();
    const result = call({ name: 'run_project', input: {} });
    await vi.advanceTimersByTimeAsync(10);
    container
      .last('npm run dev')
      .print(
        '\x1b[1G\x1b[0K⠙\x1b[1G\x1b[0K⠹\x1b[1G\x1b[0KAPI listening on http://localhost:3000\r\n⠸',
      );
    container.emitPort(3000, 'open');
    const { output } = await result;
    expect(output).toContain('API listening on http://localhost:3000');
    expect(output).not.toMatch(/[\u2800-\u28ff]/);
  });

  it('reports a crash with the stack trace, as plain text', async () => {
    const { call, container } = setup();
    const result = call({ name: 'run_project', input: {} });
    await vi.advanceTimersByTimeAsync(10);
    const dev = container.last('npm run dev');
    dev.print(
      '\x1b[31mTypeError: x is not a function\x1b[39m\r\n    at file:///home/project/index.js:12:3\r\n',
    );
    dev.finish(1);
    const { ok, output } = await result;
    expect(ok).toBe(false);
    expect(output).toMatch(/^The project crashed\./);
    expect(output).toContain(
      'TypeError: x is not a function\n    at file:///home/project/index.js:12:3',
    );
  });

  it('stops waiting when the session is stopped', async () => {
    const { call, stop } = setup();
    const result = call({ name: 'run_project', input: {} });
    await vi.advanceTimersByTimeAsync(10);
    stop.stop();
    expect(await result).toEqual({ ok: false, output: 'Stopped.' });
  });
});

describe('the settle barrier', () => {
  it('tells the model and the person when the edits have not reached the document', async () => {
    const { call, notices, requests } = setup({ docSynced: false });
    expect(await call({ name: 'http_request', input: { method: 'GET', path: '/' } })).toEqual({
      ok: false,
      output: SYNC_DELAYED,
    });
    expect(notices).toEqual(['Sync with the running project is delayed.']);
    expect(requests).toHaveLength(0);
  });

  it('says sync is delayed when the container does not take the edits in time', async () => {
    const { call, container, edit, notices, serving } = setup();
    await serving();
    container.fs.stallWrites = true;
    edit('routes/users.js');
    const result = call({ name: 'http_request', input: { method: 'GET', path: '/users' } });
    await vi.advanceTimersByTimeAsync(SETTLE_WRITE_MS);
    expect(await result).toEqual({ ok: false, output: SYNC_DELAYED });
    expect(notices).toHaveLength(1);
  });

  it('sends a request only once the server has restarted on the edit', async () => {
    const { call, container, edit, requests, serving } = setup();
    await serving();
    edit('routes/users.js');
    const result = call({ name: 'http_request', input: { method: 'DELETE', path: '/users/1' } });
    await vi.advanceTimersByTimeAsync(200);
    container.emitPort(3000, 'close');
    await vi.advanceTimersByTimeAsync(300);
    expect(requests).toHaveLength(0);
    container.emitPort(3000, 'open');
    await result;
    expect(requests.map((entry) => entry.atState)).toEqual(['serving']);
  });
});

describe('http_request', () => {
  it('sends the request to the running server and shows the response', async () => {
    const { call, requests, serving, reply } = setup();
    await serving();
    reply(response(201, '{"id":3,"name":"Linus"}'));
    const result = await call({
      name: 'http_request',
      input: {
        method: 'POST',
        path: '/users',
        headers: [{ name: 'content-type', value: 'application/json' }],
        body: '{"name":"Linus"}',
      },
    });
    expect(requests[0]).toMatchObject({
      port: 3000,
      request: {
        method: 'POST',
        path: '/users',
        headers: [['content-type', 'application/json']],
        body: '{"name":"Linus"}',
      },
    });
    expect(result).toEqual({
      ok: true,
      output:
        'HTTP 201 OK, 12 ms\ncontent-type: application/json\n\n{\n  "id": 3,\n  "name": "Linus"\n}',
    });
  });

  it('adds the server output to a server error, where the stack trace is', async () => {
    const { call, container, serving, reply } = setup();
    await serving();
    container
      .last('npm run dev')
      .print('Error: boom\r\n    at file:///home/project/routes/users.js:30:11\r\n');
    reply(response(500, '{"error":"boom"}'));
    const { output } = await call({
      name: 'http_request',
      input: { method: 'GET', path: '/users' },
    });
    expect(output).toContain('HTTP 500 Internal Server Error');
    expect(output).toContain('Recent output:\n');
    expect(output).toContain('at file:///home/project/routes/users.js:30:11');
  });

  it('refuses when nothing is running, or the program crashed', async () => {
    const { call, container, serving } = setup();
    expect(await call({ name: 'http_request', input: { method: 'GET', path: '/' } })).toEqual({
      ok: false,
      output: "The project isn't running. Call run_project first.",
    });
    await serving();
    container.last('npm run dev').finish(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (await call({ name: 'http_request', input: { method: 'GET', path: '/' } })).output,
    ).toMatch(/^The server is down: the program crashed\./);
  });
});

describe('read_terminal and stop_project', () => {
  it('reads the last lines as plain text', async () => {
    const { call, container, serving } = setup();
    expect((await call({ name: 'read_terminal', input: {} })).output).toMatch(
      /^There is no output yet/,
    );
    await serving();
    container.last('npm run dev').print('\x1b[32mone\x1b[39m\r\ntwo\r\nthree\r\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(await call({ name: 'read_terminal', input: { lines: 2 } })).toEqual({
      ok: true,
      output: 'two\nthree',
    });
  });

  it('stops the project', async () => {
    const { call, runner, serving } = setup();
    await serving();
    expect(await call({ name: 'stop_project', input: {} })).toEqual({
      ok: true,
      output: 'The project is stopped.',
    });
    expect(runner.state().phase).toBe('stopped');
  });
});

describe('run_command', () => {
  it('runs node or npm in the sandbox and reports the exit code and output', async () => {
    const { call, container, serving } = setup();
    await serving();
    const result = call({ name: 'run_command', input: { command: 'node', args: ['--test'] } });
    await vi.advanceTimersByTimeAsync(10);
    const child = container.last('node --test');
    child.print('# pass 3\r\n# fail 1\r\n');
    child.finish(1);
    const { ok, output } = await result;
    expect(ok).toBe(false);
    expect(output).toMatch(/^node --test exited with code 1 after [\d.]+ s\.\n# pass 3\n# fail 1$/);
  });

  it('stops a command that runs too long', async () => {
    const { call, container, serving } = setup();
    await serving();
    const result = call({ name: 'run_command', input: { command: 'npm', args: ['test'] } });
    await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS + OUTPUT_GRACE_MS);
    expect((await result).output).toMatch(/^npm was stopped after 60 seconds\./);
    expect(container.last('npm test').killed).toBe(true);
  });

  it('kills the command when the session is stopped', async () => {
    const { call, container, serving, stop } = setup();
    await serving();
    const result = call({ name: 'run_command', input: { command: 'npm', args: ['test'] } });
    await vi.advanceTimersByTimeAsync(10);
    stop.stop();
    await vi.advanceTimersByTimeAsync(OUTPUT_GRACE_MS);
    expect(await result).toEqual({ ok: false, output: 'Stopped.' });
    expect(container.last('npm test').killed).toBe(true);
  });

  it('needs a sandbox, which the first run creates', async () => {
    const { call } = setup();
    expect(
      (await call({ name: 'run_command', input: { command: 'node', args: ['-v'] } })).output,
    ).toMatch(/^Start the project with run_project first/);
  });
});

describe('a sandbox that cannot start', () => {
  const REASON = 'Running code needs cross-origin isolation. You can still edit.';

  it('tells the model it is unavailable for the session, and the person why', async () => {
    const { call, notices } = setup({ bootFails: REASON });
    const result = await call({ name: 'run_project', input: {} });
    expect(result).toEqual({ ok: false, output: sandboxUnavailable(REASON) });
    expect(result.output).toContain('Do not call run_project, run_command or http_request again');
    expect(result.output).toContain('click Run');
    expect(notices).toEqual([expect.stringContaining(REASON)]);
  });

  it('gives every run tool the same answer from then on, without trying to boot again', async () => {
    const { call, boots, requests } = setup({ bootFails: REASON });
    await call({ name: 'run_project', input: {} });
    const answers = [
      await call({ name: 'run_command', input: { command: 'npm', args: ['test'] } }),
      await call({ name: 'http_request', input: { method: 'DELETE', path: '/users/1' } }),
      await call({ name: 'run_project', input: {} }),
    ];
    expect(answers).toEqual(Array(3).fill({ ok: false, output: sandboxUnavailable(REASON) }));
    expect(boots()).toBe(1);
    expect(requests).toEqual([]);
    // Reading the terminal and stopping still answer as usual.
    expect((await call({ name: 'stop_project', input: {} })).ok).toBe(true);
  });

  it('is unavailable from the start when the page is known not to run code, never booting', async () => {
    const { call, boots, runner } = setup({ sandboxProblem: REASON });
    expect(await call({ name: 'run_project', input: {} })).toEqual({
      ok: false,
      output: sandboxUnavailable(REASON),
    });
    expect(boots()).toBe(0);
    expect(runner.state().phase).toBe('idle');
  });

  it('is not what a failed install is: the sandbox is there, so commands still run', async () => {
    const { call, container } = setup();
    container.installExitCode = 1;
    const run = await call({ name: 'run_project', input: {} });
    expect(run.output).toMatch(/^The run failed/);
    const command = call({ name: 'run_command', input: { command: 'node', args: ['-v'] } });
    await vi.advanceTimersByTimeAsync(10);
    container.last('node -v').finish(0);
    await vi.advanceTimersByTimeAsync(OUTPUT_GRACE_MS);
    expect((await command).output).toMatch(/^node -v exited with code 0/);
  });
});
