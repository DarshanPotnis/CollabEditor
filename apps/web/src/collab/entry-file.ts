/**
 * Which file a visitor opens first: the template's entry path, if it is still
 * there, otherwise the first file in display order. Every client picks the
 * same one because both inputs are resolved identically everywhere.
 */
import { isTemplateId, getTemplate, type ProjectMeta, type ResolvedTree } from '@collabcode/shared';

function firstFile(tree: ResolvedTree, parentId: string | null): string | null {
  for (const id of tree.childrenOf.get(parentId) ?? []) {
    const node = tree.byId.get(id);
    if (node?.kind === 'file') return id;
  }
  for (const id of tree.childrenOf.get(parentId) ?? []) {
    if (tree.byId.get(id)?.kind !== 'folder') continue;
    const found = firstFile(tree, id);
    if (found) return found;
  }
  return null;
}

export function entryFileId(tree: ResolvedTree, meta: ProjectMeta | null): string | null {
  if (meta && isTemplateId(meta.template)) {
    const id = tree.idByPath.get(getTemplate(meta.template).entryPath);
    if (id !== undefined && tree.byId.get(id)?.kind === 'file') return id;
  }
  return firstFile(tree, null);
}
