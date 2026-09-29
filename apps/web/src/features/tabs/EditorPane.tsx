/**
 * The middle pane: open tabs, a banner when the active file is gone, and the
 * editor. The editor stays mounted whatever is active, because it holds every
 * open tab's model and binding. An overlay, such as an AI edit to review,
 * covers the editor without unmounting it.
 */
import type { ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { ResolvedTree } from '@collabcode/shared';
import {
  CodeEditor,
  type CodeEditorHandle,
  type EditorAiAction,
  type RevealRequest,
} from '../editor/CodeEditor.js';
import type { ModelSpec } from '../editor/model-registry.js';
import { DeletedBanner, PurgedNotice } from './FileStateBanner.js';
import { TabBar } from './TabBar.js';
import { tabStatus } from './tabs-state.js';
import type { Tabs } from './useTabs.js';

export type EditorPaneProps = {
  tree: ResolvedTree;
  tabs: Tabs;
  specs: ReadonlyMap<string, ModelSpec>;
  awareness: Awareness;
  reveal: RevealRequest | null;
  myUserId: string;
  onRestore: (id: string) => void;
  onFileSizeLimit: () => void;
  onAiAction: (action: EditorAiAction) => void;
  editorRef: React.Ref<CodeEditorHandle>;
  overlay: ReactNode;
};

export function EditorPane({
  tree,
  tabs,
  specs,
  awareness,
  reveal,
  myUserId,
  onRestore,
  onFileSizeLimit,
  onAiAction,
  editorRef,
  overlay,
}: EditorPaneProps): React.ReactElement {
  const { activeId } = tabs.state;
  const status = activeId === null ? null : tabStatus(tree, activeId);
  const activeTab = tabs.state.tabs.find((tab) => tab.id === activeId);
  const showsEditor = activeId !== null && specs.has(activeId);

  return (
    <section aria-label="Editor" className="flex h-full flex-col">
      <TabBar state={tabs.state} tree={tree} onActivate={tabs.activate} onClose={tabs.close} />
      {status?.kind === 'deleted' && activeId !== null && (
        <DeletedBanner
          hidden={status.hidden}
          myUserId={myUserId}
          onRestore={() => onRestore(activeId)}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <CodeEditor
          awareness={awareness}
          specs={specs}
          activeId={activeId}
          reveal={reveal}
          onFileSizeLimit={onFileSizeLimit}
          onAiAction={onAiAction}
          ref={editorRef}
        />
        {showsEditor && overlay}
        {!showsEditor && (
          <div className="absolute inset-0 bg-zinc-950">
            {status?.kind === 'purged' && activeTab ? (
              <PurgedNotice name={activeTab.lastName} onClose={() => tabs.close(activeTab.id)} />
            ) : (
              <p className="p-4 text-sm text-zinc-500">
                Open a file from the tree to start editing.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
