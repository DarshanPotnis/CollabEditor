import type { ResolvedTree } from '@collabcode/shared';

/**
 * Where "New file" puts the file, given the selected row: inside a selected
 * folder, next to a selected file, at the root when nothing is selected.
 */
export function creationParent(tree: ResolvedTree, selectedId: string | null): string | null {
  const node = selectedId === null ? undefined : tree.byId.get(selectedId);
  if (!node) return null;
  return node.kind === 'folder' ? node.id : node.parentId;
}
