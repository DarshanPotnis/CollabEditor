/**
 * Keyboard behaviour for the file tree, following the WAI-ARIA treeview
 * pattern, as a pure function from a key to what should happen.
 */
import type { TreeRow } from './visible-rows.js';

export type TreeKeyAction =
  | { type: 'focus'; id: string }
  | { type: 'expand'; id: string }
  | { type: 'collapse'; id: string }
  | { type: 'open'; id: string }
  | { type: 'rename'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'none' };

export type TreeKey = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

const NONE: TreeKeyAction = { type: 'none' };

export function treeKeyAction(
  event: TreeKey,
  rows: readonly TreeRow[],
  focusedId: string | null,
): TreeKeyAction {
  if (event.altKey || event.ctrlKey) return NONE;

  const index = rows.findIndex((row) => row.id === focusedId);
  const row = rows[index];
  const first = rows[0];
  const last = rows[rows.length - 1];

  if (!row) {
    return first && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
      ? { type: 'focus', id: first.id }
      : NONE;
  }

  const focus = (target: TreeRow | undefined): TreeKeyAction =>
    target ? { type: 'focus', id: target.id } : NONE;

  switch (event.key) {
    case 'ArrowDown':
      return focus(rows[index + 1]);
    case 'ArrowUp':
      return focus(rows[index - 1]);
    case 'Home':
      return focus(first);
    case 'End':
      return focus(last);
    case 'ArrowRight':
      if (row.kind !== 'folder') return NONE;
      if (!row.expanded) return { type: 'expand', id: row.id };
      return row.hasChildren ? focus(rows[index + 1]) : NONE;
    case 'ArrowLeft':
      if (row.kind === 'folder' && row.expanded) return { type: 'collapse', id: row.id };
      return row.parentId === null ? NONE : { type: 'focus', id: row.parentId };
    case 'Enter':
    case ' ':
      if (row.kind === 'file') return { type: 'open', id: row.id };
      return row.expanded ? { type: 'collapse', id: row.id } : { type: 'expand', id: row.id };
    case 'F2':
      return { type: 'rename', id: row.id };
    case 'Delete':
      return { type: 'delete', id: row.id };
    case 'Backspace':
      // macOS has no Delete key on laptops; Cmd+Backspace is Finder's shortcut.
      return event.metaKey ? { type: 'delete', id: row.id } : NONE;
    default:
      return NONE;
  }
}
