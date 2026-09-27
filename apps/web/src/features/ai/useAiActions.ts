/**
 * The AI helpers started from the editor: "Explain with AI" and "Edit with
 * AI" on a selection. Explain sends at once. Edit anchors the selection when
 * it is chosen, asks for an instruction, and holds the target until the
 * answer is applied or discarded. Applying goes through the editor
 * (CodeEditorHandle.applyEdit), which refuses if the selected code changed.
 */
import { useCallback, useState, type RefObject } from 'react';
import type { CodeEditorHandle, EditorAiAction } from '../editor/CodeEditor.js';
import { anchorSelection, type SelectionAnchor } from '../editor/selection-anchor.js';
import type { ActiveSelection } from '../editor/model-registry.js';
import { describeSelection } from './ai-messages.js';
import { editProposal, type EditProposal, type EditTarget } from './edit-proposal.js';
import {
  editSelectionStep,
  explainSelectionStep,
  lineOfOffset,
  type SelectionSource,
} from './prompts/selection-prompts.js';
import type { AiRequestControls } from './useAiRequest.js';

export type AiActionsDeps = {
  projectId: string;
  request: AiRequestControls;
  editor: RefObject<CodeEditorHandle | null>;
  /** Shows the AI view of the side panel. */
  showAiView: () => void;
  openFile: (fileId: string) => void;
  notify: (message: string, tone: 'info' | 'error') => void;
};

type PendingEdit = { selection: ActiveSelection; anchor: SelectionAnchor };

export type AiActions = {
  onEditorAction: (action: EditorAiAction) => void;
  /** What the instruction dialog is for, while it is open. */
  instructionTarget: string | null;
  submitInstruction: (instruction: string) => string | null;
  cancelInstruction: () => void;
  proposal: EditProposal;
  /** Why the last Apply was refused. */
  applyError: string | null;
  applyEdit: () => void;
  discardEdit: () => void;
  showEdit: () => void;
};

function sourceOf(selection: ActiveSelection): SelectionSource {
  return {
    path: selection.spec.path,
    language: selection.spec.language,
    text: selection.text,
    start: selection.start,
    end: selection.end,
  };
}

const UNDO_HINT = 'Undo (Ctrl+Z, or ⌘Z on a Mac) takes it back.';

export function useAiActions({
  projectId,
  request,
  editor,
  showAiView,
  openFile,
  notify,
}: AiActionsDeps): AiActions {
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const { start, dismiss } = request;

  const onEditorAction = useCallback(
    ({ kind, selection }: EditorAiAction) => {
      if (kind === 'edit') {
        const anchor = anchorSelection(selection.spec.ytext, selection.start, selection.end);
        setPending({ selection, anchor });
        return;
      }
      const built = explainSelectionStep(projectId, sourceOf(selection));
      if (!built.ok) {
        notify(built.message, 'error');
        return;
      }
      setTarget(null);
      showAiView();
      start(built.step);
    },
    [projectId, notify, showAiView, start],
  );

  const submitInstruction = useCallback(
    (instruction: string): string | null => {
      if (!pending) return null;
      const { selection, anchor } = pending;
      const built = editSelectionStep(projectId, sourceOf(selection), instruction);
      if (!built.ok) return built.message;
      setPending(null);
      setApplyError(null);
      setTarget({
        step: built.step,
        fileId: selection.fileId,
        path: selection.spec.path,
        language: selection.spec.language,
        startLine: lineOfOffset(selection.text, selection.start),
        anchor,
      });
      showAiView();
      start(built.step);
      return null;
    },
    [pending, projectId, showAiView, start],
  );

  const proposal = editProposal(request.state, target);

  const applyEdit = useCallback(() => {
    if (proposal.kind !== 'ready') return;
    const { fileId, anchor, path } = proposal.target;
    const result = editor.current?.applyEdit(fileId, anchor, proposal.replacement) ?? {
      ok: false,
      message: 'The editor is still loading. Try again in a moment.',
    };
    if (!result.ok) {
      setApplyError(result.message);
      return;
    }
    setTarget(null);
    dismiss();
    notify(`Applied the AI edit to ${path}. ${UNDO_HINT}`, 'info');
  }, [proposal, editor, dismiss, notify]);

  const discardEdit = useCallback(() => {
    setTarget(null);
    setApplyError(null);
    dismiss();
  }, [dismiss]);

  const showEdit = useCallback(() => {
    if (target) openFile(target.fileId);
  }, [target, openFile]);

  const instructionTarget = pending
    ? describeSelection(
        pending.selection.spec.path,
        lineOfOffset(pending.selection.text, pending.selection.start),
        pending.selection.text.slice(pending.selection.start, pending.selection.end),
      )
    : null;

  return {
    onEditorAction,
    instructionTarget,
    submitInstruction,
    cancelInstruction: () => setPending(null),
    proposal,
    applyError,
    applyEdit,
    discardEdit,
    showEdit,
  };
}
