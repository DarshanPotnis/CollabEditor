/**
 * Every open tab's Monaco model, its y-monaco binding, and its undo history,
 * all shown through one editor.
 *
 * Every open tab stays bound, not only the active one: an unbound model would
 * fall behind remote edits, and rebinding it would call setValue, wiping its
 * undo stack and moving the cursor. y-monaco supports several bindings on one
 * editor because each of its handlers checks `editor.getModel() === model`,
 * which is also why it only draws remote cursors belonging to the shown file.
 *
 * Undo is per user. y-monaco tags its transactions with the binding itself as
 * the origin (verified in 0.1.6: `doc.transact(…, this)`), so a Y.UndoManager
 * per file tracking only that binding undoes this person's typing and never a
 * collaborator's. The manager lives on the file, not the model: when a rename
 * forces a new model and binding, the new binding is added to its tracked
 * origins and the history carries over. Each model's own undo and redo are
 * routed to that manager (route-history.ts), so no Monaco path, keybinding,
 * menu or command, can reach Monaco's shared stack.
 */
import * as monaco from 'monaco-editor';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { MonacoBinding } from 'y-monaco';
import { planModels } from './model-plan.js';
import { routeModelHistory } from './route-history.js';

export type ModelSpec = {
  uri: monaco.Uri;
  language: string;
  ytext: Y.Text;
  readOnly: boolean;
};

type Entry = {
  key: string;
  spec: ModelSpec;
  model: monaco.editor.ITextModel;
  binding: MonacoBinding;
};

type History = { ytext: Y.Text; undo: Y.UndoManager };

export type ModelRegistry = {
  /** Make the models match the open tabs, and show the active one. */
  sync: (specs: ReadonlyMap<string, ModelSpec>, activeId: string | null) => void;
  undo: () => void;
  redo: () => void;
  /** The Y.Text shown in the editor, for the file size guard. */
  activeText: () => Y.Text | null;
  destroy: () => void;
};

const CURSOR_META = 'cursor';

export function createModelRegistry(
  editor: monaco.editor.IStandaloneCodeEditor,
  awareness: Awareness,
): ModelRegistry {
  const entries = new Map<string, Entry>();
  const histories = new Map<string, History>();
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  let shownId: string | null = null;

  const shown = (): Entry | undefined => (shownId === null ? undefined : entries.get(shownId));

  /**
   * Remember where the cursor was when each change landed, and put it back
   * there on undo, so undoing jumps to the undone text rather than leaving the
   * cursor wherever it happened to be.
   */
  const createHistory = (fileId: string, ytext: Y.Text): History => {
    const undo = new Y.UndoManager(ytext, { trackedOrigins: new Set() });
    undo.on('stack-item-added', ({ stackItem }) => {
      const entry = entries.get(fileId);
      const selection = editor.getSelection();
      if (!entry || editor.getModel() !== entry.model || !selection) return;
      const offset = entry.model.getOffsetAt(selection.getStartPosition());
      stackItem.meta.set(CURSOR_META, Y.createRelativePositionFromTypeIndex(ytext, offset));
    });
    undo.on('stack-item-popped', ({ stackItem }) => {
      const entry = entries.get(fileId);
      const relative: unknown = stackItem.meta.get(CURSOR_META);
      const doc = ytext.doc;
      if (!entry || !doc || editor.getModel() !== entry.model) return;
      if (!(relative instanceof Y.RelativePosition)) return;
      const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
      if (absolute?.type !== ytext) return;
      const position = entry.model.getPositionAt(absolute.index);
      editor.setPosition(position);
      editor.revealPositionInCenterIfOutsideViewport(position);
    });
    return { ytext, undo };
  };

  const disposeEntry = (fileId: string): void => {
    const entry = entries.get(fileId);
    if (!entry) return;
    histories.get(fileId)?.undo.removeTrackedOrigin(entry.binding);
    entry.binding.destroy();
    entry.model.dispose();
    entries.delete(fileId);
  };

  const createEntry = (fileId: string, spec: ModelSpec): void => {
    let history = histories.get(fileId);
    if (history?.ytext !== spec.ytext) {
      history?.undo.destroy();
      history = createHistory(fileId, spec.ytext);
      histories.set(fileId, history);
    }
    const model = monaco.editor.createModel(spec.ytext.toJSON(), spec.language, spec.uri);
    const binding = new MonacoBinding(spec.ytext, model, new Set([editor]), awareness);
    history.undo.addTrackedOrigin(binding);
    routeModelHistory(model, history.undo);
    entries.set(fileId, { key: spec.uri.toString(), spec, model, binding });
  };

  /**
   * Tell collaborators where the cursor is in the file now shown. Monaco does
   * not fire a cursor event on setModel, so y-monaco would otherwise keep
   * publishing the old file's selection until the cursor moved. The format is
   * y-monaco's own awareness field: relative anchor and head positions.
   */
  const publishSelection = (entry: Entry | undefined): void => {
    const selection = editor.getSelection();
    if (!entry || !selection) {
      awareness.setLocalStateField('selection', null);
      return;
    }
    const at = (position: monaco.IPosition): Y.RelativePosition =>
      Y.createRelativePositionFromTypeIndex(entry.spec.ytext, entry.model.getOffsetAt(position));
    const start = selection.getStartPosition();
    const end = selection.getEndPosition();
    const rtl = selection.getDirection() === monaco.SelectionDirection.RTL;
    awareness.setLocalStateField('selection', {
      anchor: at(rtl ? end : start),
      head: at(rtl ? start : end),
    });
  };

  const show = (activeId: string | null, hadFocus: boolean): void => {
    const target = activeId === null ? undefined : entries.get(activeId);
    if (editor.getModel() !== (target?.model ?? null)) {
      editor.setModel(target?.model ?? null);
      if (target && activeId !== null) {
        const state = viewStates.get(activeId);
        if (state) editor.restoreViewState(state);
        if (hadFocus) editor.focus();
      }
      publishSelection(target);
    }
    shownId = target ? activeId : null;
    editor.updateOptions({ readOnly: target?.spec.readOnly ?? false });
  };

  return {
    sync(specs, activeId) {
      // Read before anything is disposed: disposing the shown model drops focus.
      const hadFocus = editor.hasTextFocus();
      const current = shown();
      if (current && shownId !== null && editor.getModel() === current.model) {
        viewStates.set(shownId, editor.saveViewState());
      }

      const plan = planModels(
        new Map([...entries].map(([id, entry]) => [id, entry.key])),
        new Map([...specs].map(([id, spec]) => [id, spec.uri.toString()])),
      );
      for (const fileId of plan.dispose) disposeEntry(fileId);
      for (const fileId of [...histories.keys()]) {
        if (specs.has(fileId)) continue;
        histories.get(fileId)?.undo.destroy();
        histories.delete(fileId);
        viewStates.delete(fileId);
      }
      for (const fileId of plan.create) {
        const spec = specs.get(fileId);
        if (spec) createEntry(fileId, spec);
      }
      show(activeId, hadFocus);
    },

    undo() {
      const entry = shown();
      if (entry && !entry.spec.readOnly && shownId !== null) histories.get(shownId)?.undo.undo();
    },

    redo() {
      const entry = shown();
      if (entry && !entry.spec.readOnly && shownId !== null) histories.get(shownId)?.undo.redo();
    },

    activeText: () => shown()?.spec.ytext ?? null,

    destroy() {
      editor.setModel(null);
      for (const fileId of [...entries.keys()]) disposeEntry(fileId);
      for (const history of histories.values()) history.undo.destroy();
      histories.clear();
      viewStates.clear();
      shownId = null;
    },
  };
}
