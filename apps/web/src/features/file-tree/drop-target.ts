/**
 * Where a dragged or pasted node lands: into a folder, next to a file (into
 * the file's folder), or at the root when dropped on empty space. Whether the
 * move is allowed is exactly what the move op will check.
 */
import { moveProblem, type ResolvedTree } from '@collabcode/shared';

export function dropParent(tree: ResolvedTree, overId: string | null): string | null {
  const node = overId === null ? undefined : tree.byId.get(overId);
  if (!node) return null;
  return node.kind === 'folder' ? node.id : node.parentId;
}

export function canMoveInto(tree: ResolvedTree, nodeId: string, parentId: string | null): boolean {
  return moveProblem(tree, nodeId, parentId) === null;
}
