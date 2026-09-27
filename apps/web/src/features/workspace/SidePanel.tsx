/**
 * The right-hand pane: a Run | AI switch, so the layout stays at three panes
 * while AI-1's helpers are one-shot. AI-2 revisits this so the agent's panel
 * and the terminal can be seen together (docs/PLAN-AI.md §7).
 *
 * Both views stay mounted and the other one is only hidden: a run keeps going
 * while the AI view is shown, and its terminal refits when shown again.
 */
import type { ReactNode } from 'react';
import { Tabs, panelId, tabId, type TabDefinition } from '../ui/Tabs.js';

export type SideView = 'run' | 'ai';

const SIDE_TABS: readonly TabDefinition<SideView>[] = [
  { id: 'run', label: 'Run' },
  { id: 'ai', label: 'AI' },
];

export type SidePanelProps = {
  view: SideView;
  onViewChange: (view: SideView) => void;
  run: ReactNode;
  ai: ReactNode;
};

export function SidePanel({ view, onViewChange, run, ai }: SidePanelProps): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      <Tabs
        label="Side panel"
        tabs={SIDE_TABS}
        selected={view}
        onSelect={onViewChange}
        idPrefix="side"
      />
      {SIDE_TABS.map(({ id }) => (
        <div
          key={id}
          role="tabpanel"
          id={panelId('side', id)}
          aria-labelledby={tabId('side', id)}
          hidden={view !== id}
          className="min-h-0 flex-1"
        >
          {id === 'run' ? run : ai}
        </div>
      ))}
    </div>
  );
}
