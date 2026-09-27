/**
 * Open tabs for this browser tab. The template's entry file opens once, when
 * the project first has content; after that, tabs are entirely the user's.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ResolvedTree } from '@collabcode/shared';
import { EMPTY_TABS, tabsReducer, type TabsState } from './tabs-state.js';

export type Tabs = {
  state: TabsState;
  open: (id: string) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
};

export function useTabs(tree: ResolvedTree, entryId: string | null): Tabs {
  const [state, dispatch] = useReducer(tabsReducer, EMPTY_TABS);
  const openedEntry = useRef(false);

  useEffect(() => {
    dispatch({ type: 'remember', tree });
  }, [tree]);

  useEffect(() => {
    if (openedEntry.current || entryId === null) return;
    openedEntry.current = true;
    dispatch({ type: 'open', id: entryId, name: tree.byId.get(entryId)?.displayName ?? '' });
  }, [entryId, tree]);

  const open = useCallback(
    (id: string) =>
      dispatch({
        type: 'open',
        id,
        name: tree.byId.get(id)?.displayName ?? tree.hidden.get(id)?.name ?? '',
      }),
    [tree],
  );
  const activate = useCallback((id: string) => dispatch({ type: 'activate', id }), []);
  const close = useCallback((id: string) => dispatch({ type: 'close', id }), []);

  return { state, open, activate, close };
}
