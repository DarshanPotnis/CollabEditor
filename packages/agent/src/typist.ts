/**
 * How an edit reaches the document. Instant typing applies each edit in one
 * transaction, which is what the evals use. The browser's live typing (a later
 * step) types the new text in over about a second so collaborators can watch.
 * Either way the write goes through the shared text ops, with the agent's
 * origin, so it respects the file-size limit and "Undo AI changes" finds it.
 */
import { replaceText, type TextChange } from '@collabcode/shared';
import type * as Y from 'yjs';
import type { StopSignal } from './types.js';

export type TextEdit = {
  doc: Y.Doc;
  fileId: string;
  oldText: string;
  newText: string;
  origin: unknown;
};

export type Typist = {
  /** Applies the edit, or throws the OpError that refused it. */
  replace: (edit: TextEdit, signal: StopSignal) => Promise<TextChange>;
};

export const instantTypist: Typist = {
  replace: ({ doc, fileId, oldText, newText, origin }) =>
    Promise.resolve(replaceText(doc, fileId, oldText, newText, origin)),
};
