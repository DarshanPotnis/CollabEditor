/**
 * The three panes: file tree | editor | run panel. Sizes are remembered per
 * browser, and the separators are keyboard-resizable (arrow keys) because
 * react-resizable-panels implements the ARIA separator pattern.
 */
import type { ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { bestEffortStorage } from '../../lib/best-effort-storage.js';
import { browserStorage } from '../../lib/identity.js';
import { PaneErrorBoundary } from './PaneErrorBoundary.js';

const layoutStorage = bestEffortStorage(browserStorage());

export type WorkspaceLayoutProps = {
  tree: ReactNode;
  editor: ReactNode;
  run: ReactNode;
};

function ResizeHandle({ label }: { label: string }): React.ReactElement {
  return (
    <Separator
      aria-label={label}
      className="w-px bg-zinc-800 outline-none transition-colors data-[separator=active]:bg-sky-500 data-[separator=focus]:bg-sky-500 data-[separator=hover]:bg-zinc-500"
    />
  );
}

export function WorkspaceLayout({ tree, editor, run }: WorkspaceLayoutProps): React.ReactElement {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'collabcode.workspace.v1',
    storage: layoutStorage,
    onlySaveAfterUserInteractions: true,
  });

  return (
    <Group
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="h-full"
    >
      <Panel id="tree" defaultSize="18%" minSize="160px" maxSize="40%">
        <PaneErrorBoundary pane="file tree">{tree}</PaneErrorBoundary>
      </Panel>
      <ResizeHandle label="Resize the file tree" />
      <Panel id="editor" minSize="30%">
        <PaneErrorBoundary pane="editor">{editor}</PaneErrorBoundary>
      </Panel>
      <ResizeHandle label="Resize the run panel" />
      <Panel id="run" defaultSize="24%" minSize="180px" maxSize="50%">
        <PaneErrorBoundary pane="run panel">{run}</PaneErrorBoundary>
      </Panel>
    </Group>
  );
}
