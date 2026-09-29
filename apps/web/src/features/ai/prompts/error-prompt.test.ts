import { AI_INPUT_LIMITS } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import {
  EXCERPT_RADIUS,
  codeExcerpt,
  explainErrorStep,
  runFailure,
  type ProjectFiles,
} from './error-prompt.js';

function numbered(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${String(index + 1)}`).join('\n');
}

function files(contents: Record<string, string>): ProjectFiles {
  return { paths: new Set(Object.keys(contents)), read: (path) => contents[path] ?? null };
}

const CRASH = [
  '\x1b[33m$ node index.js\x1b[39m\r',
  "TypeError: Cannot read properties of undefined (reading 'name')\r",
  '    at Object.<anonymous> (/home/project/index.js:40:15)\r',
  '    at Module._compile (node:internal/modules/cjs/loader:1554:14)\r',
  '',
].join('\n');

describe('codeExcerpt', () => {
  it('takes the lines around the focus line', () => {
    expect(codeExcerpt(numbered(100), 40)).toEqual({
      startLine: 40 - EXCERPT_RADIUS,
      code: numbered(40 + EXCERPT_RADIUS)
        .split('\n')
        .slice(40 - EXCERPT_RADIUS - 1)
        .join('\n'),
      focusLine: 40,
    });
  });

  it('stops at the edges of the file', () => {
    expect(codeExcerpt(numbered(5), 2)).toEqual({ startLine: 1, code: numbered(5), focusLine: 2 });
  });

  it('shrinks around the focus line to fit the cap', () => {
    const long = 'z'.repeat(1_000);
    const text = Array.from({ length: 31 }, (_, index) => (index === 15 ? 'CRASH' : long)).join(
      '\n',
    );
    const excerpt = codeExcerpt(text, 16);
    expect(excerpt?.code.length).toBeLessThanOrEqual(AI_INPUT_LIMITS.excerptChars);
    expect(excerpt?.code.split('\n')).toContain('CRASH');
  });

  it('gives nothing when the line is gone or too long to send', () => {
    expect(codeExcerpt(numbered(5), 9)).toBeNull();
    expect(codeExcerpt('x'.repeat(AI_INPUT_LIMITS.excerptChars + 1), 1)).toBeNull();
  });
});

describe('explainErrorStep', () => {
  it('sends the outcome, the plain output and the code around the crash', () => {
    const built = explainErrorStep(
      'p1',
      { outcome: 'exited', exitCode: 1, rawOutput: CRASH },
      files({ 'index.js': numbered(60) }),
    );
    expect(built).toMatchObject({
      ok: true,
      step: {
        projectId: 'p1',
        promptId: 'explain-error',
        inputs: {
          outcome: 'exited',
          exitCode: 1,
          terminalOutput: expect.stringMatching(/^\$ node index\.js\nTypeError/) as unknown,
          excerpt: {
            path: 'index.js',
            language: 'javascript',
            startLine: 25,
            focusLine: 40,
          },
        },
      },
    });
  });

  it('sends a whole ES module without a crash line, since its line numbers are shifted', () => {
    const esm = [
      "TypeError: Cannot read properties of undefined (reading 'port')",
      '    at eval (file:///home/project/index.js:16:23)',
    ].join('\n');
    const built = explainErrorStep(
      'p1',
      { outcome: 'stopped-listening', rawOutput: esm },
      files({ 'index.js': numbered(8) }),
    );
    expect(built.ok && built.step.inputs).toMatchObject({
      excerpt: { path: 'index.js', startLine: 1, code: numbered(8) },
    });
    expect(
      built.ok && 'excerpt' in built.step.inputs && built.step.inputs.excerpt,
    ).not.toHaveProperty('focusLine');
  });

  it('leaves out an ES module too long to send whole', () => {
    const esm = 'Error: boom\n    at file:///home/project/index.js:3:1';
    const big = 'x'.repeat(AI_INPUT_LIMITS.excerptChars + 1);
    const built = explainErrorStep(
      'p1',
      { outcome: 'exited', exitCode: 1, rawOutput: esm },
      files({ 'index.js': big }),
    );
    expect(built.ok && built.step.inputs).not.toHaveProperty('excerpt');
  });

  it('sends the output alone when it points at no project file', () => {
    const built = explainErrorStep(
      'p1',
      { outcome: 'failed', rawOutput: 'npm error Missing script: "start"\n' },
      files({ 'index.js': 'x' }),
    );
    expect(built.ok && built.step.inputs).toEqual({
      outcome: 'failed',
      terminalOutput: 'npm error Missing script: "start"',
    });
  });

  it('refuses when there is no output yet, with the prompt’s own message', () => {
    expect(
      explainErrorStep('p1', { outcome: 'stopped-listening', rawOutput: '\x1b[0m\r\n' }, files({})),
    ).toEqual({ ok: false, message: 'There is no output to explain yet.' });
  });
});

describe('runFailure', () => {
  const script = 'start' as const;

  it('describes each way a run stops on an error', () => {
    expect(runFailure({ phase: 'crashed', script, reason: 'exited', exitCode: 1 }, 'out')).toEqual({
      outcome: 'exited',
      exitCode: 1,
      rawOutput: 'out',
    });
    expect(runFailure({ phase: 'crashed', script, reason: 'stopped-listening' }, 'out')).toEqual({
      outcome: 'stopped-listening',
      rawOutput: 'out',
    });
    expect(runFailure({ phase: 'crashed', script, reason: 'watch-failed' }, 'out')).toEqual({
      outcome: 'exited',
      rawOutput: 'out',
    });
    expect(runFailure({ phase: 'failed', message: 'npm install failed' }, 'out')).toEqual({
      outcome: 'failed',
      rawOutput: 'out',
    });
  });

  it('has nothing to explain while a run is fine or stopped on purpose', () => {
    expect(runFailure({ phase: 'idle' }, '')).toBeNull();
    expect(runFailure({ phase: 'stopped' }, '')).toBeNull();
  });
});
