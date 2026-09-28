/**
 * Saying in awareness that you just edited a file, which is what the AI
 * agent's presence rule reads (docs/PLAN-AI.md §4). Throttled: while someone
 * types, the value changes at most every few seconds, well inside the rule's
 * 30-second window.
 */
import * as Y from 'yjs';

export const LAST_EDIT_THROTTLE_MS = 5_000;

/** Returns the function to call on every local edit. */
export function createLastEditPublisher(
  publish: (at: number) => void,
  now: () => number,
  throttleMs = LAST_EDIT_THROTTLE_MS,
): () => void {
  let lastPublished = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - lastPublished < throttleMs) return;
    lastPublished = at;
    publish(at);
  };
}

/**
 * A transaction that changed file text from this browser: typing, an applied
 * AI edit, an undo. Another peer's edits, the AI agent's included, arrive as
 * remote transactions and do not count.
 */
export function isLocalTextEdit(transaction: Y.Transaction): boolean {
  return (
    transaction.local && [...transaction.changed.keys()].some((type) => type instanceof Y.Text)
  );
}
