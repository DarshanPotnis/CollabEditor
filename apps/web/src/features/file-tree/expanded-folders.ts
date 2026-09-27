/**
 * Which folders are expanded, remembered per project in this browser. The
 * stored value is untrusted (anyone can edit localStorage), so it is parsed.
 */
import { z } from 'zod';
import type { StorageLike } from '../../lib/identity.js';

const storedSchema = z.array(z.string().max(64)).max(2_000);

export function expandedKey(projectId: string): string {
  return `collabcode.expanded.v1.${projectId}`;
}

export function loadExpanded(storage: StorageLike, projectId: string): Set<string> {
  const raw = storage.getItem(expandedKey(projectId));
  if (raw === null) return new Set();
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    // Not JSON: someone edited it by hand. Start collapsed.
    return new Set();
  }
}

export function saveExpanded(
  storage: StorageLike,
  projectId: string,
  ids: ReadonlySet<string>,
): void {
  storage.setItem(expandedKey(projectId), JSON.stringify([...ids]));
}
