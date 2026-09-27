import { describe, expect, it } from 'vitest';
import { createOutputBuffer, type OutputSink } from './output-buffer.js';

function recorder(): OutputSink & { text: string } {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
    },
  };
}

describe('createOutputBuffer', () => {
  it('replays what was written before a terminal attached, then forwards', () => {
    const buffer = createOutputBuffer();
    buffer.write('$ npm install\r\n');
    const terminal = recorder();
    buffer.attach(terminal);
    buffer.write('added 64 packages\r\n');
    expect(terminal.text).toBe('$ npm install\r\nadded 64 packages\r\n');
  });

  it('stops forwarding after detach and replays everything to the next terminal', () => {
    const buffer = createOutputBuffer();
    const first = recorder();
    const detach = buffer.attach(first);
    buffer.write('a');
    detach();
    buffer.write('b');
    expect(first.text).toBe('a');
    const second = recorder();
    buffer.attach(second);
    expect(second.text).toBe('ab');
  });

  it('keeps only the most recent output', () => {
    const buffer = createOutputBuffer(5);
    buffer.write('0123456789');
    const terminal = recorder();
    buffer.attach(terminal);
    expect(terminal.text).toBe('56789');
  });
});
