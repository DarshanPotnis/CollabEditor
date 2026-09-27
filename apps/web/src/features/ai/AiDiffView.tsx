/**
 * An AI edit to review, shown over the editor: the selected code against the
 * suggested replacement in a read-only Monaco diff, with Apply and Discard.
 * Brute force: it appears once the answer is complete rather than filling in
 * as it streams.
 *
 * The diff editor and its two models are created and disposed in one effect,
 * so StrictMode's double mount leaves nothing behind.
 */
import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

/**
 * Works around a Monaco 0.57 bug. Every standalone editor, including the two
 * inside a diff editor, points a global hover factory at its own services
 * when it is created (standaloneCodeEditor.js). A diff editor's services die
 * with it, so after one is disposed every context menu throws "Instantiation-
 * Service has been disposed" and never opens. A top-level editor points the
 * factory back at Monaco's global services, which are never disposed, so one
 * is created and dropped straight away.
 */
function restoreGlobalHoverFactory(): void {
  monaco.editor.create(document.createElement('div')).dispose();
}

export type AiDiffViewProps = {
  /** What was asked, such as "Edit routes/users.js, lines 12–15: …". */
  title: string;
  original: string;
  replacement: string;
  language: string;
  /** Line number of the selection's first line, so the diff shows real line numbers. */
  startLine: number;
  /** Why the last Apply was refused, if it was. */
  error: string | null;
  onApply: () => void;
  onDiscard: () => void;
};

export function AiDiffView({
  title,
  original,
  replacement,
  language,
  startLine,
  error,
  onApply,
  onDiscard,
}: AiDiffViewProps): React.ReactElement {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const models = {
      original: monaco.editor.createModel(original, language),
      modified: monaco.editor.createModel(replacement, language),
    };
    const diff = monaco.editor.createDiffEditor(element, {
      theme: 'vs-dark',
      fontSize: 13,
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: (line) => String(line + startLine - 1),
    });
    diff.setModel(models);
    return () => {
      // Detached first, so no diff still being computed outlives its models.
      diff.setModel(null);
      diff.dispose();
      models.original.dispose();
      models.modified.dispose();
      restoreGlobalHoverFactory();
    };
  }, [original, replacement, language, startLine]);

  return (
    <section
      aria-label="AI edit to review"
      className="absolute inset-0 z-10 flex flex-col bg-zinc-950"
    >
      <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-sky-300 uppercase">
            AI edit to review
          </p>
          <p className="truncate text-sm text-zinc-300" title={title}>
            {title}
          </p>
        </div>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:border-zinc-500"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={error !== null}
          className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
      </div>
      {error !== null && (
        <p
          role="alert"
          className="border-b border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      <div ref={container} className="min-h-0 flex-1" />
    </section>
  );
}
