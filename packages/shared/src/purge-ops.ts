/**
 * Permanently deleting items from "Recently deleted": the node maps and the
 * content are removed from the document, for everyone.
 *
 * Only nodes this client currently sees as deleted are removed. A node someone
 * else creates inside a purged folder at the same moment is not in this
 * client's view, so it survives, and the missing-parent rule shows it at the
 * root.
 *
 * Race, by design (ADR 004): if someone restores an item while someone else
 * purges it, the purge wins. The restore writes fields inside the node's
 * Y.Map, the purge deletes that Y.Map from `nodes`, and Yjs discards changes
 * to a deleted type. Every client converges on the item being gone.
 */
import type * as Y from 'yjs';
import { listDeletedItems, purgeTargets } from './deleted-items.js';
import { OPS_ORIGIN, OpError } from './op-error.js';
import { contentsMap, nodesMap } from './schema.js';
import { resolveDocTree } from './tree-ops.js';

export type PurgeResult = { purgedIds: string[] };

/** Permanently delete the given items, or every item with 'all'. */
export function purgeDeleted(doc: Y.Doc, items: readonly string[] | 'all'): PurgeResult {
  const tree = resolveDocTree(doc);
  const itemIds = items === 'all' ? listDeletedItems(tree).map((item) => item.id) : items;
  const targets = purgeTargets(tree, itemIds);
  if (!targets) {
    throw new OpError(
      'not-found',
      'That item is no longer in Recently deleted. Someone may have restored it.',
    );
  }
  if (targets.length === 0) return { purgedIds: [] };

  doc.transact(() => {
    const nodes = nodesMap(doc);
    const contents = contentsMap(doc);
    for (const id of targets) {
      nodes.delete(id);
      contents.delete(id);
    }
  }, OPS_ORIGIN);

  return { purgedIds: targets };
}
