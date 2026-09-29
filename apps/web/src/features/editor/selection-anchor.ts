/**
 * Pins a selection to the text it covers, so an AI edit prepared for it can
 * be applied later in the right place, or refused if that text has changed.
 *
 * The ends are Yjs relative positions, so they follow the text through
 * everyone's edits elsewhere in the file. The start sticks to the character
 * after it and the end to the character before it, so text typed right
 * against either end lands outside the range instead of stretching it.
 *
 * Apply refuses when the range no longer holds exactly the text that was
 * selected: a collaborator (or the person themselves) edited it while the
 * model was writing, and overwriting that would silently lose their work.
 */
import * as Y from 'yjs';
import { fileSizeLimitMessage, pasteWouldExceedLimit } from './file-size-guard.js';

export type SelectionAnchor = {
  start: Y.RelativePosition;
  end: Y.RelativePosition;
  /** The text the selection held when it was anchored. */
  original: string;
};

export type PlannedEdit =
  | { ok: true; start: number; end: number; text: string }
  | { ok: false; reason: 'changed' | 'too-large'; message: string };

export const CHANGED_MESSAGE =
  'The selected code changed after you asked, so the edit was not applied. Select the code again and ask again.';

export function anchorSelection(ytext: Y.Text, start: number, end: number): SelectionAnchor {
  return {
    start: Y.createRelativePositionFromTypeIndex(ytext, start, 0),
    end: Y.createRelativePositionFromTypeIndex(ytext, end, -1),
    original: ytext.toJSON().slice(start, end),
  };
}

function resolve(ytext: Y.Text, position: Y.RelativePosition): number | null {
  const doc = ytext.doc;
  if (!doc) return null;
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc);
  return absolute?.type === ytext ? absolute.index : null;
}

/** Where the replacement goes now, or why it must not be applied. */
export function planAnchoredEdit(
  ytext: Y.Text,
  anchor: SelectionAnchor,
  replacement: string,
): PlannedEdit {
  const start = resolve(ytext, anchor.start);
  const end = resolve(ytext, anchor.end);
  const current = start === null || end === null ? null : ytext.toJSON().slice(start, end);
  if (start === null || end === null || current !== anchor.original) {
    return { ok: false, reason: 'changed', message: CHANGED_MESSAGE };
  }
  if (pasteWouldExceedLimit(ytext.length - (end - start), replacement)) {
    return { ok: false, reason: 'too-large', message: fileSizeLimitMessage() };
  }
  return { ok: true, start, end, text: replacement };
}
