/**
 * What "Recently deleted" shows, derived from a resolved tree.
 *
 * An item is the top of a hidden subtree: a tombstoned node whose parent is
 * still visible (or the root). A file deleted on its own and then swallowed by
 * its folder's delete is part of that folder's item, not a separate one; if
 * the folder is restored, the file reappears here as an item of its own.
 */
import type { HiddenNode, ResolvedTree } from './resolve-tree.js';

export type DeletedItem = {
  id: string;
  kind: HiddenNode['kind'];
  name: string;
  /** Path of the folder it was in, or null for the project root. */
  folderPath: string | null;
  deletedAt: number;
  deletedBy: string | null;
  deletedByName: string | null;
  /** How many hidden nodes sit beneath it and go with it. */
  containedCount: number;
};

function hiddenChildren(tree: ResolvedTree): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const node of tree.hidden.values()) {
    if (node.parentId === null || !tree.hidden.has(node.parentId)) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  return children;
}

/** The item and every hidden node beneath it. */
function subtree(children: ReadonlyMap<string, string[]>, rootId: string): string[] {
  const ids = [rootId];
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (id !== undefined) ids.push(...(children.get(id) ?? []));
  }
  return ids;
}

function isItem(tree: ResolvedTree, node: HiddenNode): boolean {
  return node.causeId === node.id && (node.parentId === null || !tree.hidden.has(node.parentId));
}

/** Newest deletion first, ties broken by id so the order is stable. */
export function listDeletedItems(tree: ResolvedTree): DeletedItem[] {
  const children = hiddenChildren(tree);
  const items: DeletedItem[] = [];

  for (const node of tree.hidden.values()) {
    if (!isItem(tree, node)) continue;
    items.push({
      id: node.id,
      kind: node.kind,
      name: node.name,
      folderPath: node.parentId === null ? null : (tree.byId.get(node.parentId)?.path ?? null),
      deletedAt: node.deletedAt,
      deletedBy: node.deletedBy,
      deletedByName: node.deletedByName,
      containedCount: subtree(children, node.id).length - 1,
    });
  }

  return items.sort((a, b) => b.deletedAt - a.deletedAt || (a.id < b.id ? -1 : 1));
}

/**
 * Every node to remove for these items: each item and the hidden nodes this
 * client can see beneath it. Returns null if any id is not currently an item,
 * for example because someone restored it a moment ago.
 */
export function purgeTargets(tree: ResolvedTree, itemIds: readonly string[]): string[] | null {
  const children = hiddenChildren(tree);
  const targets = new Set<string>();
  for (const id of itemIds) {
    const node = tree.hidden.get(id);
    if (!node || !isItem(tree, node)) return null;
    for (const each of subtree(children, id)) targets.add(each);
  }
  return [...targets];
}
