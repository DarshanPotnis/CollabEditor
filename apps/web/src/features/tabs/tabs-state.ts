/**
 * Open tabs, local to this browser tab and never synced. A tab holds a node
 * id, so it follows its file through renames and moves; its name is
 * remembered only so a file that was permanently deleted can still be named.
 */
import type { HiddenNode, ResolvedNode, ResolvedTree } from '@collabcode/shared';

export type Tab = { id: string; lastName: string };

export type TabsState = { tabs: readonly Tab[]; activeId: string | null };

export type TabsAction =
  | { type: 'open'; id: string; name: string }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string }
  | { type: 'remember'; tree: ResolvedTree };

export const EMPTY_TABS: TabsState = { tabs: [], activeId: null };

export type TabStatus =
  | { kind: 'live'; node: ResolvedNode }
  | { kind: 'deleted'; hidden: HiddenNode }
  | { kind: 'purged' };

export function tabStatus(tree: ResolvedTree, id: string): TabStatus {
  const node = tree.byId.get(id);
  if (node) return { kind: 'live', node };
  const hidden = tree.hidden.get(id);
  if (hidden) return { kind: 'deleted', hidden };
  return { kind: 'purged' };
}

function currentName(tree: ResolvedTree, id: string): string | undefined {
  return tree.byId.get(id)?.displayName ?? tree.hidden.get(id)?.name;
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      if (state.tabs.some((tab) => tab.id === action.id)) {
        return state.activeId === action.id ? state : { ...state, activeId: action.id };
      }
      // New tabs open to the right of the active one, as in most editors.
      const at = state.tabs.findIndex((tab) => tab.id === state.activeId);
      const tabs = [...state.tabs];
      tabs.splice(at + 1, 0, { id: action.id, lastName: action.name });
      return { tabs, activeId: action.id };
    }
    case 'activate':
      return state.tabs.some((tab) => tab.id === action.id) && state.activeId !== action.id
        ? { ...state, activeId: action.id }
        : state;
    case 'close': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      if (state.activeId !== action.id) return { ...state, tabs };
      const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
      return { tabs, activeId: neighbour?.id ?? null };
    }
    case 'remember': {
      let changed = false;
      const tabs = state.tabs.map((tab) => {
        const name = currentName(action.tree, tab.id);
        if (name === undefined || name === tab.lastName) return tab;
        changed = true;
        return { ...tab, lastName: name };
      });
      return changed ? { ...state, tabs } : state;
    }
  }
}

/**
 * The folder to show next to a tab's name when another open tab has the same
 * name (two index.js files), or null when the name is unique.
 */
export function tabHints(tabs: readonly Tab[], tree: ResolvedTree): Map<string, string | null> {
  const counts = new Map<string, number>();
  for (const tab of tabs) counts.set(tab.lastName, (counts.get(tab.lastName) ?? 0) + 1);

  const hints = new Map<string, string | null>();
  for (const tab of tabs) {
    if ((counts.get(tab.lastName) ?? 0) < 2) {
      hints.set(tab.id, null);
      continue;
    }
    const node = tree.byId.get(tab.id);
    const parent = node?.parentId ? tree.byId.get(node.parentId) : undefined;
    hints.set(tab.id, node ? (parent?.path ?? 'project root') : null);
  }
  return hints;
}
