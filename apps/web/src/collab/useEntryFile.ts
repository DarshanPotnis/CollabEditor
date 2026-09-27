/**
 * The one file the Phase 1 editor shows, until tabs replace it: the
 * template's entry file (see entry-file.ts), tracked as the tree changes.
 */
import { useEffect, useState } from 'react';
import { metaMap, nodesMap, readMeta, resolveDocTree, type ResolvedNode } from '@collabcode/shared';
import { entryFileId } from './entry-file.js';
import type { ProjectSession } from './useProject.js';

export type EntryFile = Pick<ResolvedNode, 'id' | 'name'>;

export function useEntryFile(session: ProjectSession | null): EntryFile | null {
  const [file, setFile] = useState<EntryFile | null>(null);

  useEffect(() => {
    if (!session) {
      setFile(null);
      return;
    }

    const nodes = nodesMap(session.doc);
    const meta = metaMap(session.doc);
    const update = (): void => {
      setFile((current) => {
        const tree = resolveDocTree(session.doc);
        const id = entryFileId(tree, readMeta(session.doc));
        const node = id === null ? undefined : tree.byId.get(id);
        const next = node ? { id: node.id, name: node.displayName } : null;
        // Keep the same object when nothing changed, so effects downstream
        // (the Monaco binding in particular) do not restart on every keystroke.
        if (current && next && current.id === next.id && current.name === next.name) return current;
        return next;
      });
    };

    update();
    nodes.observeDeep(update);
    meta.observe(update);
    return () => {
      nodes.unobserveDeep(update);
      meta.unobserve(update);
    };
  }, [session]);

  return file;
}
