/**
 * Keeping the conversation under the size cap (120,000 characters the model
 * reads, the same measure the server enforces). The oldest tool results lose
 * their text first; the model's own messages are never changed, since they go
 * back to the provider exactly as it sent them.
 */
import { conversationChars, type ConversationEntry } from '@collabcode/shared';

export function elidedOutput(chars: number): string {
  return `[output removed to keep the conversation short: ${chars.toLocaleString('en-US')} characters]`;
}

/** An output removed on an earlier step, which must keep saying how long the original was. */
const ELIDED = /^\[output removed to keep the conversation short: [\d,]+ characters\]$/;

/**
 * The conversation within `maxChars`, or null when even removing every tool
 * result but the latest would not be enough. The latest is what the model is
 * about to act on, so it is never removed.
 */
export function fitConversation(
  entries: readonly ConversationEntry[],
  maxChars: number,
): ConversationEntry[] | null {
  let total = conversationChars(entries);
  if (total <= maxChars) return [...entries];

  const lastTool = entries.findLastIndex((entry) => entry.role === 'tool');
  const fitted = [...entries];
  for (let index = 0; index < lastTool && total > maxChars; index += 1) {
    const entry = fitted[index];
    if (entry?.role !== 'tool') continue;
    fitted[index] = {
      role: 'tool',
      results: entry.results.map((result) => {
        const marker = elidedOutput(result.output.length);
        if (
          total <= maxChars ||
          ELIDED.test(result.output) ||
          marker.length >= result.output.length
        ) {
          return result;
        }
        total -= result.output.length - marker.length;
        return { ...result, output: marker };
      }),
    };
  }
  return total <= maxChars ? fitted : null;
}
