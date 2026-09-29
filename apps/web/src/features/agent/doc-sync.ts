/**
 * The first half of the settle barrier (the runner's settle() is the second).
 * The running project is fed from the person's own document (ADR 005), and
 * the agent's edits reach that document through the server, from the agent's
 * replica. Before anything runs, the person's document must have them; on a
 * slow connection that takes a while, and on a dropped one it may not happen,
 * so the wait is bounded.
 */
import * as Y from 'yjs';

export const DOC_SYNC_TIMEOUT_MS = 10_000;

/** Whether `target` has received everything `author` wrote itself. */
export function hasEditsOf(author: Y.Doc, target: Y.Doc): boolean {
  const written = Y.decodeStateVector(Y.encodeStateVector(author)).get(author.clientID) ?? 0;
  const received = Y.decodeStateVector(Y.encodeStateVector(target)).get(author.clientID) ?? 0;
  return received >= written;
}

/** True once `target` has `author`'s edits; false after the timeout or a stop. */
export function waitForEditsOf(
  author: Y.Doc,
  target: Y.Doc,
  signal: AbortSignal,
  timeoutMs = DOC_SYNC_TIMEOUT_MS,
): Promise<boolean> {
  if (hasEditsOf(author, target)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (result: boolean): void => {
      clearTimeout(timer);
      target.off('update', onUpdate);
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onUpdate = (): void => {
      if (hasEditsOf(author, target)) done(true);
    };
    const onAbort = (): void => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    target.on('update', onUpdate);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
