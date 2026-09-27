import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse-parser.js';

const STREAM = 'data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n';

function feed(pieces: string[]): string[] {
  const parser = createSseParser();
  return pieces.flatMap((piece) => parser.push(piece));
}

describe('createSseParser', () => {
  it('reads a whole stream that arrives in one piece', () => {
    expect(feed([STREAM])).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it('gives the same events however the stream is split', () => {
    for (let size = 1; size <= STREAM.length; size++) {
      const pieces: string[] = [];
      for (let at = 0; at < STREAM.length; at += size) pieces.push(STREAM.slice(at, at + size));
      expect(feed(pieces), `pieces of ${String(size)}`).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
    }
  });

  it('completes an event only at its blank line', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"n":1}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual(['{"n":1}']);
  });

  it('never completes an event the stream cuts off', () => {
    expect(feed(['data: {"n":1}\n\ndata: {"n":2}'])).toEqual(['{"n":1}']);
    expect(feed(['data: {"n":1}\n\ndata: {"n":2}\n'])).toEqual(['{"n":1}']);
  });

  it('accepts CRLF line endings, even split between pieces', () => {
    expect(feed(['data: a\r\n\r\ndata: b\r', '\n\r', '\n'])).toEqual(['a', 'b']);
  });

  it('joins several data lines with line breaks', () => {
    expect(feed(['data: one\ndata: two\n\n'])).toEqual(['one\ntwo']);
  });

  it('removes one space after the colon, and only one', () => {
    expect(feed(['data:tight\n\ndata:  spaced\n\n'])).toEqual(['tight', ' spaced']);
  });

  it('skips comments, other fields and blank lines between events', () => {
    expect(feed([': keep-alive\n\nevent: x\nid: 7\nretry: 10\ndata: kept\n\n\n\n'])).toEqual([
      'kept',
    ]);
  });

  it('treats a bare data line as empty data', () => {
    expect(feed(['data\n\n'])).toEqual(['']);
  });
});
