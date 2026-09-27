/**
 * Write-time rules for the file tree, as pure checks over a resolved tree.
 *
 * The tree ops use these to refuse a bad write, and the UI uses the same
 * functions to decide, before anything is written, whether a drop target is
 * valid or a name is free. They run against the local view, so they cannot
 * see edits that are offline or in flight; resolve-tree.ts covers those.
 */
import { withCopySuffix } from './display-name.js';
import type { ResolvedNode, ResolvedTree } from './resolve-tree.js';

/**
 * Names compare case-insensitively at write time. A project may later be
 * cloned onto macOS or Windows, where `Index.js` and `index.js` are the same
 * file. `toLowerCase` is locale-independent, unlike `toLocaleLowerCase`.
 */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * The visible sibling whose name or display name matches `name` ignoring
 * case, or null. Display names count too: otherwise renaming something to
 * `utils (2).js` would push an existing duplicate's shown name along.
 */
export function findNameClash(
  tree: ResolvedTree,
  parentId: string | null,
  name: string,
  exceptId: string | null = null,
): ResolvedNode | null {
  const key = nameKey(name);
  for (const siblingId of tree.childrenOf.get(parentId) ?? []) {
    if (siblingId === exceptId) continue;
    const sibling = tree.byId.get(siblingId);
    if (!sibling) continue;
    if (nameKey(sibling.name) === key || nameKey(sibling.displayName) === key) return sibling;
  }
  return null;
}

/** The first `name`, `name (2)`, `name (3)`… that clashes with no sibling. */
export function freeName(
  tree: ResolvedTree,
  parentId: string | null,
  name: string,
  exceptId: string | null = null,
): string {
  if (!findNameClash(tree, parentId, name, exceptId)) return name;
  let copy = 2;
  while (findNameClash(tree, parentId, withCopySuffix(name, copy), exceptId)) copy += 1;
  return withCopySuffix(name, copy);
}

/** Is `folderId` the node itself or somewhere beneath it, in the resolved tree? */
export function isSameOrInside(tree: ResolvedTree, nodeId: string, folderId: string): boolean {
  let current: string | null = folderId;
  while (current !== null) {
    if (current === nodeId) return true;
    current = tree.byId.get(current)?.parentId ?? null;
  }
  return false;
}

export type MoveProblem =
  | { kind: 'not-found' }
  | { kind: 'invalid-parent' }
  | { kind: 'would-create-cycle' }
  | { kind: 'duplicate-name'; clash: ResolvedNode }
  | { kind: 'no-op' };

/** Why moving `nodeId` into `targetParentId` (null for root) is refused, or null. */
export function moveProblem(
  tree: ResolvedTree,
  nodeId: string,
  targetParentId: string | null,
): MoveProblem | null {
  const node = tree.byId.get(nodeId);
  if (!node) return { kind: 'not-found' };
  if (targetParentId !== null && tree.byId.get(targetParentId)?.kind !== 'folder') {
    return { kind: 'invalid-parent' };
  }
  if (node.parentId === targetParentId) return { kind: 'no-op' };
  if (targetParentId !== null && isSameOrInside(tree, nodeId, targetParentId)) {
    return { kind: 'would-create-cycle' };
  }
  const clash = findNameClash(tree, targetParentId, node.name, nodeId);
  if (clash) return { kind: 'duplicate-name', clash };
  return null;
}
