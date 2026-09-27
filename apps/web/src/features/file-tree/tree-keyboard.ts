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
  | { type: 'menu'; id: string }
  | { type: 'cut'; id: string }
  | { type: 'paste'; overId: string }
  | { type: 'cancel' }
  | { type: 'none' };

export type TreeKey = {
  key: string;
  shiftKey: boolean;
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
  if (event.altKey) return NONE;

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

  // Cut and paste is the keyboard way to move, alongside drag and drop.
  if (event.ctrlKey || event.metaKey) {
    const letter = event.key.toLowerCase();
    if (letter === 'x') return { type: 'cut', id: row.id };
    if (letter === 'v') return { type: 'paste', overId: row.id };
    // macOS laptops have no Delete key; Cmd+Backspace is Finder's shortcut.
    if (event.key === 'Backspace' && event.metaKey) return { type: 'delete', id: row.id };
    return NONE;
  }

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
    case 'F10':
      return event.shiftKey ? { type: 'menu', id: row.id } : NONE;
    case 'ContextMenu':
      return { type: 'menu', id: row.id };
    case 'Delete':
      return { type: 'delete', id: row.id };
    case 'Escape':
      return { type: 'cancel' };
    default:
      return NONE;
  }
}
