import { useCallback, useEffect, useState } from 'react';
import { bestEffortStorage } from '../../lib/best-effort-storage.js';
import { browserStorage } from '../../lib/identity.js';
import { loadExpanded, saveExpanded } from './expanded-folders.js';

const storage = bestEffortStorage(browserStorage());

export type ExpandedFolders = {
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  setExpanded: (id: string, open: boolean) => void;
  expandAll: (ids: readonly string[]) => void;
};

export function useExpandedFolders(projectId: string): ExpandedFolders {
  const [expanded, setState] = useState<ReadonlySet<string>>(() =>
    loadExpanded(storage, projectId),
  );

  useEffect(() => {
    saveExpanded(storage, projectId, expanded);
  }, [projectId, expanded]);

  const setExpanded = useCallback((id: string, open: boolean) => {
    setState((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setState((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback((ids: readonly string[]) => {
    setState((current) => {
      if (ids.every((id) => current.has(id))) return current;
      return new Set([...current, ...ids]);
    });
  }, []);

  return { expanded, toggle, setExpanded, expandAll };
}
