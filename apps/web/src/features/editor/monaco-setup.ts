/**
 * Monaco is bundled with the app rather than loaded from a CDN: the version is
 * pinned by the lockfile, and it will still work under the cross-origin
 * isolation headers that Phase 3 needs for WebContainers.
 *
 * Bundling means we own the web workers too, which Vite gives us as `?worker`
 * imports.
 */
import type * as monaco from 'monaco-editor';
// monaco-editor 0.57 ships an exports map: deep paths are addressed as
// `monaco-editor/<path under esm/vs>`, not `monaco-editor/esm/vs/<path>`.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

let configured = false;

export function setupMonaco(): void {
  if (configured) return;
  configured = true;

  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'json') return new JsonWorker();
      if (label === 'typescript' || label === 'javascript') return new TsWorker();
      return new EditorWorker();
    },
  };
}
