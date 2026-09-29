import { describe, expect, it } from 'vitest';
import { isWatcherCrashLine, watchForCrashes } from './watch-signals.js';

/** As captured from the container's Node 22, colour codes included. */
const NODE_WATCH_CRASH =
  "\x1b[31mFailed running 'index.js'. Waiting for file changes before restarting...\x1b[39m\r\n";

function crashesIn(chunks: string[]): number {
  let count = 0;
  const feed = watchForCrashes(() => (count += 1));
  for (const chunk of chunks) feed(chunk);
  return count;
}

describe('isWatcherCrashLine', () => {
  it("recognises node --watch's crash line, colour codes and all", () => {
    expect(isWatcherCrashLine(NODE_WATCH_CRASH)).toBe(true);
  });

  it("recognises nodemon's crash line", () => {
    expect(
      isWatcherCrashLine('[nodemon] app crashed - waiting for file changes before starting...'),
    ).toBe(true);
  });

  it.each([
    "Completed running 'index.js'. Waiting for file changes before restarting...",
    "Restarting 'index.js'",
    "console.log('Failed running the tests. Waiting for file changes before restarting...')",
    'TypeError: Failed running query',
  ])('ignores %s', (line) => {
    expect(isWatcherCrashLine(line)).toBe(false);
  });
});

describe('watchForCrashes', () => {
  it('finds a crash line however the output is chunked', () => {
    for (let size = 1; size <= NODE_WATCH_CRASH.length; size += 7) {
      const chunks: string[] = [];
      for (let at = 0; at < NODE_WATCH_CRASH.length; at += size) {
        chunks.push(NODE_WATCH_CRASH.slice(at, at + size));
      }
      expect(crashesIn(chunks), `chunks of ${String(size)}`).toBe(1);
    }
  });

  it('reports each crash, with other output in between', () => {
    expect(
      crashesIn([
        `TypeError: boom\r\n${NODE_WATCH_CRASH}`,
        "\x1bc\x1b[32mRestarting 'index.js'\x1b[39m\r\n",
        NODE_WATCH_CRASH,
      ]),
    ).toBe(2);
  });

  it('waits for the end of the line before deciding', () => {
    expect(crashesIn([NODE_WATCH_CRASH.replace('\r\n', '')])).toBe(0);
  });

  it('keeps working after a very long line without breaks', () => {
    expect(crashesIn(['x'.repeat(100_000), `\n${NODE_WATCH_CRASH}`])).toBe(1);
  });
});
