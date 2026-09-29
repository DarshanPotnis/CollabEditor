import { describe, expect, it } from 'vitest';
import { terminalTail } from './terminal-text.js';

describe('terminalTail', () => {
  it('keeps short output whole, without surrounding blank space', () => {
    expect(terminalTail('\r\n  $ node index.js\r\nError: boom\r\n\r\n')).toBe(
      '$ node index.js\nError: boom',
    );
  });

  it('keeps only the end, starting on a whole line', () => {
    const output = ['first line', 'second line', 'Error: boom', '    at main (index.js:3:9)'].join(
      '\n',
    );
    expect(terminalTail(output, 40)).toBe('Error: boom\n    at main (index.js:3:9)');
  });

  it('measures the cap after codes are removed', () => {
    const coloured = `\x1b[31m${'x'.repeat(10)}\x1b[39m`;
    expect(terminalTail(coloured, 10)).toBe('x'.repeat(10));
  });
});
