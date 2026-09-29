/**
 * Spots, in the dev process's output, a watcher saying that the program it
 * runs has crashed.
 *
 * Under `node --watch` (the templates' dev script) a crash does not end the
 * dev process: Node prints "Failed running 'index.js'. Waiting for file
 * changes before restarting..." and waits. The process never exits and, if
 * the program crashed before listening, no port ever closes, so without this
 * line the run would look like one still starting. Checked against the
 * container's Node 22 (v22.22.3, September 2026). nodemon's equivalent line
 * is recognised too.
 *
 * Output arrives in arbitrary chunks, with colour codes, so it is read as
 * whole plain-text lines. A line that never ends is capped, so endless output
 * without line breaks cannot grow memory.
 */
import { plainTerminalText } from '@collabcode/agent';

const CRASH_LINES = [
  /^Failed running .+\. Waiting for file changes before restarting\.\.\.$/,
  /^\[nodemon\] app crashed - waiting for file changes before starting\.\.\.$/,
];

/** Longest partial line kept while waiting for its end. */
const MAX_PARTIAL_LINE = 4_096;

export function isWatcherCrashLine(line: string): boolean {
  const plain = plainTerminalText(line).trim();
  return CRASH_LINES.some((pattern) => pattern.test(plain));
}

/** Returns a function to feed output chunks to; it calls `onCrash` for each crash line. */
export function watchForCrashes(onCrash: () => void): (chunk: string) => void {
  let partial = '';
  return (chunk) => {
    const lines = (partial + chunk).split('\n');
    partial = (lines.pop() ?? '').slice(-MAX_PARTIAL_LINE);
    for (const line of lines) {
      // The \r of a \r\n ending would otherwise read as a line redrawn to nothing.
      if (isWatcherCrashLine(line.replace(/\r$/, ''))) onCrash();
    }
  };
}
