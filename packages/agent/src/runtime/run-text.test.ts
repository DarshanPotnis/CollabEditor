import { describe, expect, it } from 'vitest';
import type { ApiResult } from './request-codec.js';
import {
  RUN_MESSAGES,
  answeredStatus,
  describeCommand,
  describeHttpResult,
  exitCodeOf,
  describeRun,
  lastLines,
  sandboxUnavailable,
  stillStarting,
  withOutput,
} from './run-text.js';

const recent = () => 'API listening on http://localhost:3000';
const none = () => '';

function response(status: number, body: string, truncated = false): ApiResult {
  return {
    kind: 'response',
    response: {
      status,
      statusText: status === 200 ? 'OK' : 'Internal Server Error',
      headers: [['content-type', 'application/json']],
      body: new TextEncoder().encode(body),
      size: body.length * 3,
      truncated,
      ms: 12.4,
    },
  };
}

describe('run-text: the words every host gives the model', () => {
  it('adds recent output only when there is some', () => {
    expect(withOutput('The project crashed.', '')).toBe('The project crashed.');
    expect(withOutput('The project crashed.', 'boom')).toBe(
      'The project crashed.\n\nRecent output:\nboom',
    );
    expect(lastLines('a\nb\nc', 2)).toBe('b\nc');
    expect(lastLines('', 2)).toBe('');
  });

  it('describes each way a run can settle', () => {
    expect(describeRun({ phase: 'serving', port: 3000 }, recent)).toEqual({
      ok: true,
      output:
        'The project is running and serving on port 3000.\n\nRecent output:\nAPI listening on http://localhost:3000',
    });
    expect(describeRun({ phase: 'crashed' }, none)).toEqual({
      ok: false,
      output: 'The project crashed.',
    });
    expect(describeRun({ phase: 'failed', message: 'npm install failed' }, none).output).toBe(
      'The run failed: npm install failed',
    );
    expect(describeRun({ phase: 'stopped' }, recent)).toEqual({
      ok: false,
      output: RUN_MESSAGES.notRunning,
    });
    expect(describeRun({ phase: 'starting', stage: 'installing' }, none).output).toBe(
      'The project is still starting (installing).',
    );
    expect(stillStarting('installing', none).output).toBe(
      'The project is still starting after 120 seconds (installing).',
    );
  });

  it('shows a response with its status, headers and pretty body, and output only for a 5xx', () => {
    expect(describeHttpResult(response(200, '{"id":1}'), recent)).toEqual({
      ok: true,
      output: 'HTTP 200 OK, 12 ms\ncontent-type: application/json\n\n{\n  "id": 1\n}',
    });
    expect(describeHttpResult(response(500, '{}', true), recent).output).toBe(
      'HTTP 500 Internal Server Error, 12 ms\ncontent-type: application/json\n\n{}\n…[body truncated: 6 bytes in all]\n\nRecent output:\nAPI listening on http://localhost:3000',
    );
    expect(
      describeHttpResult({ kind: 'request-failed', message: 'ECONNREFUSED', ms: 3 }, none),
    ).toEqual({ ok: false, output: 'The request failed: ECONNREFUSED' });
  });

  it('summarises a command by how it ended, with its last lines', () => {
    expect(
      describeCommand('node', ['-v'], { kind: 'exited', code: 0, seconds: 0.25 }, 'v22.1.0'),
    ).toEqual({
      ok: true,
      output: 'node -v exited with code 0 after 0.3 s.\nv22.1.0',
    });
    expect(describeCommand('npm', ['test'], { kind: 'exited', code: 1, seconds: 2 }, '')).toEqual({
      ok: false,
      output: 'npm test exited with code 1 after 2.0 s.\n(no output)',
    });
    expect(describeCommand('npm', ['test'], { kind: 'timeout' }, 'still going').output).toBe(
      'npm was stopped after 60 seconds.\nstill going',
    );
    expect(describeCommand('npm', ['test'], { kind: 'stopped' }, 'x')).toEqual({
      ok: false,
      output: RUN_MESSAGES.stopped,
    });
  });

  it('reads back the status and exit code it wrote, for checking what finish lists', () => {
    expect(answeredStatus(describeHttpResult(response(404, '{}'), none).output)).toBe(404);
    expect(answeredStatus('The request failed: ECONNREFUSED')).toBeNull();
    const failed = describeCommand('npm', ['test'], { kind: 'exited', code: 1, seconds: 2 }, '');
    expect(exitCodeOf(failed.output, 'npm test')).toBe(1);
    expect(exitCodeOf(failed.output, 'npm')).toBeNull();
    expect(
      exitCodeOf(describeCommand('npm', [], { kind: 'timeout' }, '').output, 'npm'),
    ).toBeNull();
  });

  it('says the sandbox is unavailable the same way every time, and what to do instead', () => {
    const text = sandboxUnavailable('no isolation');
    expect(text).toBe(sandboxUnavailable('no isolation'));
    expect(text).toContain('The reason: no isolation');
    expect(text).toContain('Do not call run_project, run_command or http_request again');
    expect(text).toContain('click Run');
  });
});
