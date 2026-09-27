/**
 * One Monaco editor showing whichever open tab is active. The editor, the
 * model registry and the undo/redo actions are created in one effect and
 * destroyed in reverse order in its cleanup, so StrictMode's double mount
 * produces two complete lifecycles and the registry never outlives the editor.
 */
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { Awareness } from 'y-protocols/awareness';
import { setupMonaco } from './monaco-setup.js';
import { createModelRegistry, type ModelRegistry, type ModelSpec } from './model-registry.js';
import { isAtFileSizeLimit, isTextInsertingKey, pasteWouldExceedLimit } from './file-size-guard.js';

setupMonaco();

export type CodeEditorProps = {
  awareness: Awareness;
  specs: ReadonlyMap<string, ModelSpec>;
  activeId: string | null;
  /** Called when an edit was blocked because the file is at its size limit. */
  onFileSizeLimit: () => void;
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
  onFileSizeLimit,
}: CodeEditorProps): React.ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState<Mounted | null>(null);

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
