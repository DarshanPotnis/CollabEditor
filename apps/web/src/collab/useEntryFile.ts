/**
 * Phase 1 shows one file, so this finds it: the earliest live file node, by
 * (createdAt, id) so every client picks the same one. Phase 2 replaces this
 * with the file tree and tabs.
 */
import { useEffect, useState } from 'react';
import { nodesMap, readNodes, type NodeFields } from '@collabcode/shared';
import type { ProjectSession } from './useProject.js';

export type EntryFile = Pick<NodeFields, 'id' | 'name'>;

function earliestFile(nodes: NodeFields[]): EntryFile | null {
  const files = nodes
    .filter((node) => node.kind === 'file')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const first = files[0];
  return first ? { id: first.id, name: first.name } : null;
}

export function useEntryFile(session: ProjectSession | null): EntryFile | null {
  const [file, setFile] = useState<EntryFile | null>(null);

  useEffect(() => {
    if (!session) {
      setFile(null);
      return;
    }

    const nodes = nodesMap(session.doc);
    const update = (): void => {
      setFile((current) => {
        const next = earliestFile(readNodes(session.doc));
        // Keep the same object when nothing changed, so effects downstream
        // (the Monaco binding in particular) do not restart on every keystroke.
        if (current && next && current.id === next.id && current.name === next.name) return current;
        return next;
      });
    };

    update();
    nodes.observeDeep(update);
    return () => {
      nodes.unobserveDeep(update);
    };
  }, [session]);

  return file;
}
