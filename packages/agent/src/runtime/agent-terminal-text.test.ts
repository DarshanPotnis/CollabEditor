import { describe, expect, it } from 'vitest';
import { agentTerminalText } from './agent-terminal-text.js';

describe('agentTerminalText', () => {
  it('keeps npm install’s result and drops its spinner', () => {
    const install = [
      '\x1b[2m$ npm install\x1b[0m\r\n',
      '\x1b[1G\x1b[0K⠙\x1b[1G\x1b[0K⠹\x1b[1G\x1b[0K⠸\x1b[1G\x1b[0K',
      '\r\nadded 64 packages in 3s\r\n',
      '\x1b[1G\x1b[0K⠼\x1b[1G\x1b[0K',
      '\r\n13 packages are looking for funding\r\n',
      '\x1b[1G\x1b[0K⠴',
    ].join('');
    expect(agentTerminalText(install)).toBe(
      '$ npm install\n\nadded 64 packages in 3s\n\n13 packages are looking for funding',
    );
  });

  it("keeps npm's result and drops its ASCII spinner, as in the WebContainer", () => {
    // What npm writes (display.js): cursorTo(0) and clearLine(1) before each frame and each
    // log line, and a last frame that is not always cleared before the next process prints.
    const clear = '\x1b[1G\x1b[0K';
    const frames = ['\\', '|', '/', '-', '\\', '|', '/']
      .map((frame) => `${clear}${frame}`)
      .join('');
    const install = [
      '\x1b[2m$ npm install\x1b[0m\r\n',
      frames,
      `${clear}\r\nadded 68 packages in 6s\r\n`,
      `${clear}/`,
      `${clear}\r\n`,
      `/${clear}28 packages are looking for funding\r\n`,
      `${clear}/${clear}  run \`npm fund\` for details\r\n`,
      `${clear}/`,
      '\x1b[2m$ npm run dev\x1b[0m\r\n\r\n> dev\r\n> node --watch index.js\r\n',
    ].join('');
    expect(agentTerminalText(install)).toBe(
      [
        '$ npm install',
        '',
        'added 68 packages in 6s',
        '',
        '28 packages are looking for funding',
        '  run `npm fund` for details',
        '$ npm run dev',
        '',
        '> dev',
        '> node --watch index.js',
      ].join('\n'),
    );
  });

  it('drops spinner frames left at the start of a line', () => {
    expect(agentTerminalText('⠧⠇API listening on http://localhost:3000')).toBe(
      'API listening on http://localhost:3000',
    );
  });

  it('keeps a stack trace exactly', () => {
    const trace = 'TypeError: x is not a function\n    at file:///home/project/index.js:12:3';
    expect(agentTerminalText(`\x1b[31m${trace}\x1b[39m\r\n`)).toBe(trace);
  });

  it('keeps lines of dashes and pipes, which are not spinners', () => {
    expect(agentTerminalText('| a | b |\n|---|---|\n-')).toBe('| a | b |\n|---|---|\n-');
  });
});
