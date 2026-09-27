/**
 * The resolved file tree as an external store for `useSyncExternalStore`.
 *
 * It observes only the `nodes` map. Keystrokes change `contents`, never
 * `nodes`, so typing never re-resolves the tree; a rename, move, create or
 * delete does, synchronously, so the tree, tabs and Monaco models all see the
 * same snapshot in the same tick. The snapshot object only changes when the
 * tree does, which is what useSyncExternalStore requires.
 */
import type * as Y from 'yjs';
import { nodesMap, resolveDocTree, type ResolvedTree } from '@collabcode/shared';

export type TreeStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ResolvedTree;
  destroy: () => void;
};

export function createTreeStore(doc: Y.Doc): TreeStore {
  const nodes = nodesMap(doc);
  const listeners = new Set<() => void>();
  let snapshot = resolveDocTree(doc);

  const onChange = (): void => {
    snapshot = resolveDocTree(doc);
    for (const listener of [...listeners]) listener();
  };
  nodes.observeDeep(onChange);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    destroy() {
      nodes.unobserveDeep(onChange);
      listeners.clear();
    },
  };
}
