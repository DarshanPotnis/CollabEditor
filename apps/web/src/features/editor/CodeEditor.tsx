/**
 * One Monaco editor showing whichever open tab is active. The editor, the
 * model registry and the undo/redo actions are created in one effect and
 * destroyed in reverse order in its cleanup, so StrictMode's double mount
 * produces two complete lifecycles and the registry never outlives the editor.
 */
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { Awareness } from 'y-protocols/awareness';
import { setupMonaco } from './monaco-setup.js';
import {
  createModelRegistry,
  type ActiveSelection,
  type ApplyEditResult,
  type ModelRegistry,
  type ModelSpec,
} from './model-registry.js';
import { isAtFileSizeLimit, isTextInsertingKey, pasteWouldExceedLimit } from './file-size-guard.js';
import type { SelectionAnchor } from './selection-anchor.js';

setupMonaco();

/** Scroll to a character offset in a file once it is shown. */
export type RevealRequest = {
  fileId: string;
  index: number;
  requestId: number;
  /** Scroll only when the position is out of view: following the AI teammate. */
  gentle?: boolean;
};

/** Someone chose Explain with AI or Edit with AI on a selection. */
export type EditorAiAction = { kind: 'explain' | 'edit'; selection: ActiveSelection };

/** What the editor lets its parent do imperatively. */
export type CodeEditorHandle = {
  applyEdit: (fileId: string, anchor: SelectionAnchor, replacement: string) => ApplyEditResult;
};

export type CodeEditorProps = {
  awareness: Awareness;
  specs: ReadonlyMap<string, ModelSpec>;
  activeId: string | null;
  reveal: RevealRequest | null;
  /** Called when an edit was blocked because the file is at its size limit. */
  onFileSizeLimit: () => void;
  onAiAction: (action: EditorAiAction) => void;
  ref?: React.Ref<CodeEditorHandle>;
};

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: 'vs-dark',
  fontSize: 14,
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  padding: { top: 12 },
  tabSize: 2,
  automaticLayout: true,
  readOnlyMessage: { value: 'This file was deleted. Restore it to keep editing.' },
};

type Mounted = { editor: monaco.editor.IStandaloneCodeEditor; registry: ModelRegistry };

export function CodeEditor({
  awareness,
  specs,
  activeId,
  reveal,
  onFileSizeLimit,
  onAiAction,
  ref,
}: CodeEditorProps): React.ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState<Mounted | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      applyEdit: (fileId, anchor, replacement) =>
        mounted
          ? mounted.registry.applyEdit(fileId, anchor, replacement)
          : { ok: false, message: 'The editor is still loading. Try again in a moment.' },
    }),
    [mounted],
  );

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const editor = monaco.editor.create(element, { ...EDITOR_OPTIONS, model: null });
    const registry = createModelRegistry(editor, awareness);

    // Undo and redo already reach this person's history from every built-in
    // path (route-history.ts). Monaco's standalone command palette lists only
    // editor actions, and its built-in undo is not one, so these give the
    // palette an Undo and Redo that go to the same place.
    const paletteUndo = editor.addAction({
      id: 'collabcode.undo',
      label: 'Undo',
      run: () => registry.undo(),
    });
    const paletteRedo = editor.addAction({
      id: 'collabcode.redo',
      label: 'Redo',
      run: () => registry.redo(),
    });

    setMounted({ editor, registry });
    return () => {
      setMounted(null);
      paletteUndo.dispose();
      paletteRedo.dispose();
      registry.destroy();
      editor.dispose();
    };
  }, [awareness]);

  useEffect(() => {
    mounted?.registry.sync(specs, activeId);
  }, [mounted, specs, activeId]);

  // Declared after the sync effect so that, when a follow opens a new tab
  // and asks to reveal in the same render, the model exists and is shown.
  useEffect(() => {
    if (reveal) mounted?.registry.reveal(reveal.fileId, reveal.index, reveal.gentle);
  }, [mounted, reveal]);

  // The AI actions, in the context menu (and the command palette) when there
  // is a selection. Editing is not offered on a deleted, read-only file.
  useEffect(() => {
    if (!mounted) return;
    const { editor, registry } = mounted;
    const runWith = (kind: EditorAiAction['kind']) => (): void => {
      const selection = registry.activeSelection();
      if (selection) onAiAction({ kind, selection });
    };
    const actions = [
      editor.addAction({
        id: 'collabcode.ai.explain',
        label: 'Explain with AI',
        contextMenuGroupId: '1_ai',
        contextMenuOrder: 1,
        precondition: 'editorHasSelection',
        run: runWith('explain'),
      }),
      editor.addAction({
        id: 'collabcode.ai.edit',
        label: 'Edit with AI…',
        contextMenuGroupId: '1_ai',
        contextMenuOrder: 2,
        precondition: 'editorHasSelection && !editorReadonly',
        run: runWith('edit'),
      }),
    ];
    return () => {
      for (const action of actions) action.dispose();
    };
  }, [mounted, onAiAction]);

  // The per-file size limit. Editor keystrokes bypass packages/shared's ops
  // (y-monaco writes into Y.Text directly), so this is where it is enforced.
  useEffect(() => {
    if (!mounted) return;
    const { editor, registry } = mounted;
    const length = (): number => registry.activeText()?.length ?? 0;

    const keyGuard = editor.onKeyDown((event) => {
      if (!isAtFileSizeLimit(length())) return;
      const inserting = isTextInsertingKey({
        key: event.browserEvent.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });
      if (!inserting) return;
      event.preventDefault();
      event.stopPropagation();
      onFileSizeLimit();
    });

    const node = editor.getDomNode();
    const pasteGuard = (event: ClipboardEvent): void => {
      const pasted = event.clipboardData?.getData('text') ?? '';
      if (!pasteWouldExceedLimit(length(), pasted)) return;
      event.preventDefault();
      event.stopPropagation();
      onFileSizeLimit();
    };
    node?.addEventListener('paste', pasteGuard, true);

    return () => {
      keyGuard.dispose();
      node?.removeEventListener('paste', pasteGuard, true);
    };
  }, [mounted, onFileSizeLimit]);

  return <div ref={container} className="h-full" />;
}
