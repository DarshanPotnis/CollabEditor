import { describe, expect, it } from 'vitest';
import { plainTerminalText, terminalTail } from './terminal-text.js';

describe('plainTerminalText', () => {
  it('removes colours and turns CRLF into LF', () => {
    expect(plainTerminalText('\x1b[31mTypeError\x1b[39m: boom\r\n    at x\r\n')).toBe(
      'TypeError: boom\n    at x\n',
    );
  });

  it('keeps what a redrawn progress line finally showed', () => {
    expect(plainTerminalText('installing 10%\rinstalling 55%\rinstalling done\r\nnext')).toBe(
      'installing done\nnext',
    );
  });

  it('removes cursor moves, window titles and stray control characters', () => {
    expect(plainTerminalText('\x1b[2K\x1b[1Gline\x1b]0;title\x07 \b\x07end')).toBe('line end');
  });

  it('keeps tabs and plain text as they are', () => {
    expect(plainTerminalText('a\tb\nc')).toBe('a\tb\nc');
  });
});

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
