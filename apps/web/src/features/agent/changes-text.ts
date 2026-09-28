/**
 * A session's net changes (the core's sessionChanges) in words, for the panel
 * when a session ends without the model's own summary: "Edited index.js and
 * routes/users.js. Created test/users.test.js."
 */
import type { SessionChanges } from '@collabcode/agent';

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** The changes as sentences, or null when there were none. */
export function changesText(changes: SessionChanges): string | null {
  const sentences: string[] = [];
  if (changes.edited.length > 0) sentences.push(`Edited ${listed(changes.edited)}.`);
  if (changes.created.length > 0) sentences.push(`Created ${listed(changes.created)}.`);
  if (changes.renamed.length > 0) {
    sentences.push(`Renamed ${listed(changes.renamed.map(({ from, to }) => `${from} to ${to}`))}.`);
  }
  if (changes.deleted.length > 0) sentences.push(`Deleted ${listed(changes.deleted)}.`);
  return sentences.length === 0 ? null : sentences.join(' ');
}
