import { describe, expect, it } from 'vitest';
import { compareResults, resultSignature, type CallResult } from './replay-divergence.js';

const result = (toolName: string, output: string, isError = false): CallResult => ({
  toolName,
  isError,
  output,
});

describe('resultSignature', () => {
  it('keeps what must match: status, exit code, the lines an edit changed, error or not', () => {
    expect(resultSignature(result('http_request', 'HTTP 204 No Content, 51 ms\n\n'))).toBe(
      'status 204',
    );
    expect(
      resultSignature(
        result('run_command', 'npm test exited with code 1 after 0.4 s.\nfail', true),
      ),
    ).toBe('exit code 1');
    expect(
      resultSignature(result('edit_file', 'Edited routes/users.js (changed lines 12–16).')),
    ).toBe('edited lines 12–16');
    expect(resultSignature(result('run_project', 'The project is running and serving.'))).toBe(
      'ok',
    );
    expect(resultSignature(result('edit_file', 'routes/users.js: not in the file', true))).toBe(
      'error',
    );
  });
});

describe('compareResults', () => {
  it('lets timings, dates and wording differ', () => {
    expect(
      compareResults(
        result('http_request', 'HTTP 200 OK, 36 ms\ndate: Tue, 29 Sep 2026 18:26:12 GMT'),
        result('http_request', 'HTTP 200 OK, 51 ms\ndate: Wed, 30 Sep 2026 09:00:00 GMT'),
      ),
    ).toBeNull();
    expect(
      compareResults(
        result('run_project', 'The project is running and serving on port 3000. Output: a'),
        result('run_project', 'The project is running and serving on port 3000. Output: b'),
      ),
    ).toBeNull();
  });

  it('names both sides when the effect differs', () => {
    // successful-demo.json replayed today: the edit it recorded as refused now lands.
    expect(
      compareResults(
        result('edit_file', 'routes/users.js: The text to replace is not in the file.', true),
        result('edit_file', 'Edited routes/users.js (changed lines 23–38).'),
      ),
    ).toEqual({
      toolName: 'edit_file',
      recorded: 'error: routes/users.js: The text to replace is not in the file.',
      now: 'edited lines 23–38',
    });
    expect(
      compareResults(
        result('http_request', 'HTTP 404 Not Found, 3 ms'),
        result('http_request', 'HTTP 200 OK, 3 ms'),
      ),
    ).toEqual({ toolName: 'http_request', recorded: 'status 404', now: 'status 200' });
    expect(
      compareResults(
        result('edit_file', 'Edited a.js (changed lines 1–2).'),
        result('edit_file', 'Edited a.js (changed lines 3–4).'),
      ),
    ).toMatchObject({ recorded: 'edited lines 1–2', now: 'edited lines 3–4' });
  });
});
