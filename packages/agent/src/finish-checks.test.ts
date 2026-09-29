import { describe, expect, it } from 'vitest';
import {
  checkLabel,
  listedChecks,
  notMadeRefusal,
  verifyChecks,
  type ListedCheck,
} from './finish-checks.js';
import type { TraceToolCall } from './trace.js';

function call(toolName: string, input: unknown, output: string, isError = false): TraceToolCall {
  return { toolCallId: 'c', toolName, input, isError, output, startedAtMs: 0, durationMs: 0 };
}

const edited = call('edit_file', { path: 'routes/users.js' }, 'Edited routes/users.js.');
const refusedEdit = call('edit_file', { path: 'routes/users.js' }, 'not in the file', true);
const sent = (method: string, path: string, status: number) =>
  call('http_request', { method, path }, `HTTP ${String(status)} OK, 3 ms\n\n{}`);
const ran = (command: string, args: string[], code: number) =>
  call(
    'run_command',
    { command, args },
    `${[command, ...args].join(' ')} exited with code ${String(code)} after 0.4 s.\nok`,
    code !== 0,
  );

const request = (method: string, path: string, status: number): ListedCheck => ({
  kind: 'request',
  method,
  path,
  status,
});
const command = (line: string, exitCode: number): ListedCheck => ({
  kind: 'command',
  command: line,
  exitCode,
});

describe('listedChecks', () => {
  it("turns finish's two lists into one, requests first, and treats missing lists as empty", () => {
    expect(
      listedChecks({
        summary: 's',
        checkedRequests: [{ method: 'GET', path: '/users', status: 200 }],
        checkedCommands: [{ command: 'npm test', exitCode: 0 }],
      }),
    ).toEqual([request('GET', '/users', 200), command('npm test', 0)]);
    expect(listedChecks({ summary: 's' })).toEqual([]);
  });
});

describe('verifyChecks', () => {
  it('accepts requests and commands made after the last change, with what they got', () => {
    const calls = [
      edited,
      sent('DELETE', '/users/1', 204),
      sent('DELETE', '/users/abc', 400),
      ran('npm', ['test'], 1),
    ];
    const listed = [
      request('DELETE', '/users/1', 204),
      request('delete', '/users/abc', 400),
      command('npm  test', 1),
    ];
    expect(verifyChecks(listed, calls)).toEqual({ made: listed, notMade: [] });
  });

  it('sets apart a check never made, one that got something else, and one made before the last change', () => {
    const calls = [
      sent('GET', '/users/1', 200),
      edited,
      refusedEdit,
      sent('DELETE', '/users/99', 404),
      ran('npm', ['test'], 0),
    ];
    const result = verifyChecks(
      [
        request('POST', '/users', 201),
        request('DELETE', '/users/99', 400),
        request('GET', '/users/1', 200),
        command('npm test', 0),
        command('node --test', 0),
      ],
      calls,
    );
    expect(result.made).toEqual([command('npm test', 0)]);
    expect(result.notMade).toEqual([
      { check: request('POST', '/users', 201), reason: 'not sent' },
      { check: request('DELETE', '/users/99', 400), reason: 'it got 404' },
      { check: request('GET', '/users/1', 200), reason: 'sent before your last change' },
      { check: command('node --test', 0), reason: 'not run' },
    ]);
  });

  it('counts only an answered request, and a command that ran to an exit code', () => {
    const calls = [
      edited,
      call(
        'http_request',
        { method: 'GET', path: '/users' },
        'The request failed: no server',
        true,
      ),
      call('run_command', { command: 'npm', args: ['test'] }, 'Start the project first.', true),
    ];
    expect(
      verifyChecks([request('GET', '/users', 200), command('npm test', 0)], calls).made,
    ).toEqual([]);
  });
});

describe('the words', () => {
  it('labels each kind of check', () => {
    expect(checkLabel(request('DELETE', '/users/abc', 400))).toBe('DELETE /users/abc → 400');
    expect(checkLabel(command('npm test', 0))).toBe('npm test → exit code 0');
  });

  it('refuses a finish by naming each check it did not make, and what to do', () => {
    expect(
      notMadeRefusal([
        { check: request('POST', '/users', 201), reason: 'not sent' },
        { check: request('DELETE', '/users/99', 400), reason: 'it got 404' },
      ]),
    ).toBe(
      [
        'finish was not accepted: it lists checks this session did not make after its last change.',
        '- POST /users → 201: not sent',
        '- DELETE /users/99 → 400: it got 404',
        'Make them now and call finish again, or call finish again without them. Checks listed but not made are shown to the person as not made.',
      ].join('\n'),
    );
  });
});
