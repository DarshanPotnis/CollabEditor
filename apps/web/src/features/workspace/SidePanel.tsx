/**
 * The right-hand pane: the AI panel above the Run views, both visible at once
 * (docs/PLAN-AI.md §7 AI-2). The AI teammate's work is mostly running the
 * project and reading its output, so the person watches the agent's log and
 * the terminal together. The split is resizable and remembered per browser.
 */
import type { ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { bestEffortStorage } from '../../lib/best-effort-storage.js';
import { browserStorage } from '../../lib/identity.js';
import { PaneErrorBoundary } from './PaneErrorBoundary.js';

const layoutStorage = bestEffortStorage(browserStorage());

export type SidePanelProps = {
  run: ReactNode;
  ai: ReactNode;
};

export function SidePanel({ run, ai }: SidePanelProps): React.ReactElement {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'collabcode.side.v1',
    storage: layoutStorage,
    onlySaveAfterUserInteractions: true,
  });

  return (
    <Group
      orientation="vertical"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="h-full"
    >
      <Panel id="ai" defaultSize="50%" minSize="120px">
        <section aria-label="AI" className="h-full">
          <PaneErrorBoundary pane="AI panel">{ai}</PaneErrorBoundary>
        </section>
      </Panel>
      <Separator
        aria-label="Resize the AI and Run panels"
        className="h-px bg-zinc-800 outline-none transition-colors data-[separator=active]:bg-sky-500 data-[separator=focus]:bg-sky-500 data-[separator=hover]:bg-zinc-500"
      />
      <Panel id="run" minSize="160px">
        <section aria-label="Run" className="h-full">
          <PaneErrorBoundary pane="Run panel">{run}</PaneErrorBoundary>
        </section>
      </Panel>
    </Group>
  );
}
