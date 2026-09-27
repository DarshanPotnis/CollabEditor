/**
 * Makes a Monaco model's own undo and redo use a per-user Y.UndoManager.
 *
 * Verified against monaco-editor 0.57: every way Monaco undoes ends in
 * `model.undo()` / `model.redo()`. That covers the Ctrl/Cmd+Z and redo
 * keybindings, `editor.trigger(…, 'undo')`, the `default:undo` proxy, menu
 * entries, and the suggest and paste widgets, which undo the edit they just
 * made. Monaco ignores the browser's native `historyUndo` input events.
 *
 * Monaco's own stack must never be used here: it would undo a collaborator's
 * edits along with yours, and because y-monaco applies remote edits with
 * `applyEdits` (not recorded on that stack), replaying it after remote
 * changes would apply old edits at shifted offsets.
 */
import type * as monaco from 'monaco-editor';
import type * as Y from 'yjs';

export function routeModelHistory(model: monaco.editor.ITextModel, undo: Y.UndoManager): void {
  model.undo = (): void => {
    undo.undo();
  };
  model.redo = (): void => {
    undo.redo();
  };
  model.canUndo = (): boolean => undo.canUndo();
  model.canRedo = (): boolean => undo.canRedo();
}
