import { describe, expect, it } from 'vitest';
import { STACK_TRACE_NOTE, truncateOutput, withStackTraceNote } from './tool-output.js';

describe('withStackTraceNote', () => {
  it('adds the note to output with an ES module stack frame', () => {
    const output =
      'TypeError: x is not a function\n    at file:///home/project/routes/users.js:27:5';
    expect(withStackTraceNote(output)).toBe(`${output}\n\n${STACK_TRACE_NOTE}`);
  });

  it('leaves output without one alone, CommonJS frames included', () => {
    for (const output of [
      'Server listening on 3000',
      'at Object.<anonymous> (/home/project/index.js:3:1)',
    ]) {
      expect(withStackTraceNote(output)).toBe(output);
    }
  });
});

describe('truncateOutput', () => {
  it('leaves output within the limit alone', () => {
    expect(truncateOutput('short', 10)).toBe('short');
  });

  it('cuts at a line break near the limit and says how much is missing', () => {
    const output = `${'a'.repeat(90)}\n${'b'.repeat(50)}`;
    expect(truncateOutput(output, 100)).toBe(`${'a'.repeat(90)}\n…[truncated 51 characters]`);
  });

  it('cuts mid-line when there is no line break near the limit', () => {
    expect(truncateOutput('x'.repeat(1_500), 1_000)).toBe(
      `${'x'.repeat(1_000)}\n…[truncated 500 characters]`,
    );
  });

  it('never keeps half of a surrogate pair', () => {
    const cut = truncateOutput(`${'a'.repeat(9)}😀tail`, 10);
    expect(cut.startsWith(`${'a'.repeat(9)}\n`)).toBe(true);
  });
});
