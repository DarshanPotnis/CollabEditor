import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { MonacoBinding } from 'y-monaco';
import type * as monaco from 'monaco-editor';
import { setupMonaco } from './monaco-setup.js';
import { languageForFileName } from './language.js';
import { isAtFileSizeLimit, isTextInsertingKey, pasteWouldExceedLimit } from './file-size-guard.js';

setupMonaco();

export type CodeEditorProps = {
  ytext: Y.Text;
  awareness: Awareness;
  fileName: string;
  /** Called when an edit was blocked because the file is at its size limit. */
  onFileSizeLimit: () => void;
};

export function CodeEditor({
  ytext,
  awareness,
  fileName,
  onFileSizeLimit,
}: CodeEditorProps): React.ReactElement {
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  // The binding is the only thing that writes editor text into the document.
  // It is created and destroyed inside one effect, so StrictMode's double
  // mount cannot leave two bindings fighting over the same model.
  useEffect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const binding = new MonacoBinding(ytext, model, new Set([editor]), awareness);
    return () => {
      binding.destroy();
    };
  }, [editor, ytext, awareness]);

  // The per-file size limit. Editor keystrokes bypass packages/shared's ops
  // (y-monaco writes into Y.Text directly), so this is where it is enforced.
  useEffect(() => {
    if (!editor) return;

    const keyGuard = editor.onKeyDown((event) => {
      if (!isAtFileSizeLimit(ytext.length)) return;
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
      if (!pasteWouldExceedLimit(ytext.length, pasted)) return;
      event.preventDefault();
      event.stopPropagation();
      onFileSizeLimit();
    };
    node?.addEventListener('paste', pasteGuard, true);

    return () => {
      keyGuard.dispose();
      node?.removeEventListener('paste', pasteGuard, true);
    };
  }, [editor, ytext, onFileSizeLimit]);

  return (
    <Editor
      className="h-full"
      theme="vs-dark"
      path={fileName}
      language={languageForFileName(fileName)}
      onMount={(mounted) => setEditor(mounted)}
      loading={<p className="p-4 text-sm text-zinc-400">Loading the editor…</p>}
      options={{
        fontSize: 14,
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        padding: { top: 12 },
        tabSize: 2,
        automaticLayout: true,
      }}
    />
  );
}
