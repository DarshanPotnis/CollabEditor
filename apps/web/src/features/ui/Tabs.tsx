/**
 * Tabs following the WAI-ARIA tabs pattern: arrow keys, Home and End move
 * between tabs and select them; only the selected tab is in the tab order.
 */
import { useRef } from 'react';

export type TabDefinition<Id extends string> = { id: Id; label: string };

export type TabsProps<Id extends string> = {
  label: string;
  tabs: readonly TabDefinition<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  /** Prefix for tab and panel element ids, unique on the page. */
  idPrefix: string;
};

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

export function panelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

export function Tabs<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
  idPrefix,
}: TabsProps<Id>): React.ReactElement {
  const buttons = useRef(new Map<Id, HTMLButtonElement>());

  const moveTo = (index: number): void => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    onSelect(tab.id);
    buttons.current.get(tab.id)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex border-b border-zinc-800">
      {tabs.map((tab, index) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) buttons.current.set(tab.id, element);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={active}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') moveTo(index + 1);
              else if (event.key === 'ArrowLeft') moveTo(index - 1);
              else if (event.key === 'Home') moveTo(0);
              else if (event.key === 'End') moveTo(tabs.length - 1);
              else return;
              event.preventDefault();
            }}
            className={`px-3 py-1.5 text-xs outline-none focus-visible:underline ${
              active
                ? 'border-b-2 border-sky-500 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
