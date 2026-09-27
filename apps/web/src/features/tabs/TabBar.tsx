/**
 * The open tabs, following the WAI-ARIA tabs pattern: arrow keys move between
 * tabs and activate them, Delete closes the focused one. Middle-click closes.
 */
import { useRef } from 'react';
import { X } from 'lucide-react';
import type { ResolvedTree } from '@collabcode/shared';
import { tabHints, tabStatus, type TabsState } from './tabs-state.js';

export type TabBarProps = {
  state: TabsState;
  tree: ResolvedTree;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
};

export function TabBar({
  state,
  tree,
  onActivate,
  onClose,
}: TabBarProps): React.ReactElement | null {
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  if (state.tabs.length === 0) return null;
  const hints = tabHints(state.tabs, tree);

  const moveTo = (index: number): void => {
    const tab = state.tabs[(index + state.tabs.length) % state.tabs.length];
    if (!tab) return;
    onActivate(tab.id);
    tabElements.current.get(tab.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex shrink-0 overflow-x-auto border-b border-zinc-800 bg-zinc-950"
    >
      {state.tabs.map((tab, index) => {
        const status = tabStatus(tree, tab.id);
        const active = tab.id === state.activeId;
        const hint = hints.get(tab.id);
        const stateLabel =
          status.kind === 'deleted'
            ? ' (deleted)'
            : status.kind === 'purged'
              ? ' (permanently deleted)'
              : '';
        return (
          <div
            key={tab.id}
            className={`group flex shrink-0 items-center border-r border-zinc-800 ${
              active ? 'bg-zinc-900 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900/60'
            }`}
          >
            <button
              ref={(element) => {
                if (element) tabElements.current.set(tab.id, element);
                else tabElements.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={status.kind === 'live' ? status.node.path : `${tab.lastName}${stateLabel}`}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') moveTo(index + 1);
                else if (event.key === 'ArrowLeft') moveTo(index - 1);
                else if (event.key === 'Home') moveTo(0);
                else if (event.key === 'End') moveTo(state.tabs.length - 1);
                else if (event.key === 'Delete') onClose(tab.id);
                else return;
                event.preventDefault();
              }}
              className={`py-1.5 pr-1 pl-3 text-sm outline-none focus-visible:underline ${
                status.kind === 'live' ? '' : 'text-red-300/80 line-through'
              }`}
            >
              {tab.lastName}
              {hint && <span className="ml-1.5 text-xs text-zinc-500 no-underline">{hint}</span>}
              <span className="sr-only">{stateLabel}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.lastName}`}
              tabIndex={-1}
              onClick={() => onClose(tab.id)}
              className={`mr-1 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 ${
                active ? '' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
