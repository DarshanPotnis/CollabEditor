/**
 * Who has each file open, for the presence dots in the tree.
 *
 * Awareness changes on every remote cursor move, but which file each person
 * is in changes rarely. `samePresence` lets the hook keep the previous map
 * when only cursors moved, so the tree does not re-render per keystroke.
 */
import type { Collaborator } from './collaborators.js';

export type FilePresence = ReadonlyMap<string, readonly Collaborator[]>;

/** Other people by the file they have open; you are left out. */
export function filePresence(collaborators: readonly Collaborator[]): FilePresence {
  const byFile = new Map<string, Collaborator[]>();
  for (const collaborator of collaborators) {
    if (collaborator.isYou || collaborator.activeFileId === null) continue;
    const people = byFile.get(collaborator.activeFileId) ?? [];
    people.push(collaborator);
    byFile.set(collaborator.activeFileId, people);
  }
  return byFile;
}

function signature(people: readonly Collaborator[]): string {
  return people
    .map((person) => `${String(person.clientId)}:${person.user.color}:${person.user.name}`)
    .join('|');
}

/** Same files, same people, same names and colors, in the same order. */
export function samePresence(a: FilePresence, b: FilePresence): boolean {
  if (a.size !== b.size) return false;
  for (const [fileId, people] of a) {
    const other = b.get(fileId);
    if (!other || signature(other) !== signature(people)) return false;
  }
  return true;
}
