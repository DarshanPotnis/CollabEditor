/**
 * The resolved tree for the current session. The store is created and
 * destroyed in one effect (StrictMode-safe); components read it through
 * useSyncExternalStore so they re-render only when the tree changes.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { resolveTree, type ResolvedTree } from '@collabcode/shared';
import { createTreeStore, type TreeStore } from './tree-store.js';
import type { ProjectSession } from './useProject.js';

const EMPTY_TREE = resolveTree([]);
const noop = (): void => undefined;

export function useResolvedTree(session: ProjectSession | null): ResolvedTree {
  const [store, setStore] = useState<TreeStore | null>(null);

  useEffect(() => {
    if (!session) return;
    const created = createTreeStore(session.doc);
    setStore(created);
    return () => {
      created.destroy();
      setStore(null);
    };
  }, [session]);

  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : noop),
    [store],
  );
  const getSnapshot = useCallback(() => (store ? store.getSnapshot() : EMPTY_TREE), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
