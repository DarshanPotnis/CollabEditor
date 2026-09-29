import { describe, expect, it } from 'vitest';
import { plainTerminalText } from './terminal-text.js';

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

  it('reads a move to the first column as a redraw, the way npm spins', () => {
    const spinner = '\x1b[1G\x1b[0K⠙\x1b[1G\x1b[0K⠹\x1b[G\x1b[0Kadded 64 packages';
    expect(plainTerminalText(spinner)).toBe('added 64 packages');
  });

  it('removes the screen clear node --watch sends before a restart', () => {
    expect(plainTerminalText("\x1bc\x1b[32mRestarting 'index.js'\x1b[39m")).toBe(
      "Restarting 'index.js'",
    );
  });

  it('removes cursor moves, window titles and stray control characters', () => {
    expect(plainTerminalText('\x1b[2K\x1b[1Gline\x1b]0;title\x07 \b\x07end')).toBe('line end');
  });

  it('keeps tabs and plain text as they are', () => {
    expect(plainTerminalText('a\tb\nc')).toBe('a\tb\nc');
  });
});
