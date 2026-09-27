/**
 * The tree flattened into the rows currently on screen: depth first, in the
 * order resolveTree sorted each folder, descending only into expanded
 * folders. The ARIA fields let a flat list of rows act as a treeview.
 */
import type { NodeKind, ResolvedTree } from '@collabcode/shared';

export type TreeRow = {
  id: string;
  kind: NodeKind;
  displayName: string;
  path: string;
  parentId: string | null;
  /** 1-based, as aria-level wants. */
  level: number;
  /** Only meaningful for folders. */
  expanded: boolean;
  hasChildren: boolean;
  posInSet: number;
  setSize: number;
};

export function visibleRows(tree: ResolvedTree, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];

  const walk = (parentId: string | null): void => {
    const children = tree.childrenOf.get(parentId) ?? [];
    children.forEach((id, index) => {
      const node = tree.byId.get(id);
      if (!node) return;
      const isOpen = node.kind === 'folder' && expanded.has(id);
      rows.push({
        id,
        kind: node.kind,
        displayName: node.displayName,
        path: node.path,
        parentId: node.parentId,
        level: node.depth + 1,
        expanded: isOpen,
        hasChildren: (tree.childrenOf.get(id)?.length ?? 0) > 0,
        posInSet: index + 1,
        setSize: children.length,
      });
      if (isOpen) walk(id);
    });
  };

  walk(null);
  return rows;
}

/** Folder ids from the root down to (not including) this node. */
export function ancestorIds(tree: ResolvedTree, nodeId: string): string[] {
  const ids: string[] = [];
  let current = tree.byId.get(nodeId)?.parentId ?? null;
  while (current !== null) {
    ids.unshift(current);
    current = tree.byId.get(current)?.parentId ?? null;
  }
  return ids;
}

/**
 * Where a draft row for a new file or folder goes: first inside its folder,
 * right after the folder's row, or at the very top for the root. The folder
 * must already be expanded for its row to be followed by its children.
 */
export function draftInsertIndex(rows: readonly TreeRow[], parentId: string | null): number {
  if (parentId === null) return 0;
  const index = rows.findIndex((row) => row.id === parentId);
  return index === -1 ? 0 : index + 1;
}
