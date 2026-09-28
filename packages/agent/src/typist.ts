/**
 * How an edit reaches the document. Either way the write goes through the
 * shared text ops, with the agent's origin, so it respects the file-size limit
 * and "Undo AI changes" finds it.
 *
 * - Instant typing applies each edit in one transaction: what the evals use,
 *   and what a hidden tab gets, since its timers are throttled.
 * - Live typing deletes what the edit removes at once, then types the new
 *   text in over about a second, so collaborators watch it being written.
 *   Each piece goes right after the one before, anchored with a relative
 *   position, so a collaborator typing next to it neither moves it nor ends up
 *   inside it. Stop finishes the edit at once: a file is never left half-typed.
 */
import {
  OpError,
  deleteText,
  insertText,
  planReplacement,
  readFileText,
  replaceText,
  type TextChange,
} from '@collabcode/shared';
import * as Y from 'yjs';
import type { Clock, StopSignal } from './types.js';

export type TextEdit = {
  doc: Y.Doc;
  fileId: string;
  oldText: string;
  newText: string;
  origin: unknown;
  /** Where the agent's caret is as the edit is typed: the end of what is written so far. */
  onProgress?: (cursor: number) => void;
};

export type Typist = {
  /** Applies the edit, or throws the OpError that refused it. */
  replace: (edit: TextEdit, signal: StopSignal) => Promise<TextChange>;
};

export const instantTypist: Typist = {
  replace: ({ doc, fileId, oldText, newText, origin, onProgress }) => {
    const change = replaceText(doc, fileId, oldText, newText, origin);
    onProgress?.(change.index + change.insert.length);
    return Promise.resolve(change);
  },
};

export const LIVE_TYPING = {
  /** Roughly how long an edit takes to type in. */
  durationMs: 1_000,
  frameMs: 50,
  /** Longer insertions are applied at once: typing them would take too long to watch. */
  maxChars: 4_000,
} as const;

/** The end of the next piece, never between the halves of a surrogate pair. */
function pieceEnd(text: string, start: number, size: number): number {
  const end = Math.min(text.length, start + size);
  const last = text.charCodeAt(end - 1);
  return end < text.length && last >= 0xd800 && last <= 0xdbff ? end + 1 : end;
}

export function createLiveTypist(clock: Clock, instant: () => boolean = () => false): Typist {
  return {
    async replace(edit, signal) {
      const { doc, fileId, origin } = edit;
      const text = readFileText(doc, fileId);
      if (!text) throw new OpError('not-found', 'That file no longer exists.');
      const change = planReplacement(text.toJSON(), edit.oldText, edit.newText);
      if (instant() || change.insert === '' || change.insert.length > LIVE_TYPING.maxChars) {
        return instantTypist.replace(edit, signal);
      }

      deleteText(doc, fileId, change.index, change.deleteCount, origin);
      const frames = LIVE_TYPING.durationMs / LIVE_TYPING.frameMs;
      const size = Math.max(1, Math.ceil(change.insert.length / frames));
      // Just after the character before the insertion point, so each piece follows the last.
      let next = Y.createRelativePositionFromTypeIndex(text, change.index, -1);
      let start: Y.RelativePosition | null = null;
      let written = 0;

      while (written < change.insert.length) {
        const end = signal.aborted ? change.insert.length : pieceEnd(change.insert, written, size);
        const at = Y.createAbsolutePositionFromRelativePosition(next, doc);
        if (!at || at.type !== text) {
          throw new OpError('not-found', 'The file was deleted part way through the edit.');
        }
        insertText(doc, fileId, at.index, change.insert.slice(written, end), origin);
        start ??= Y.createRelativePositionFromTypeIndex(text, at.index);
        const cursor = at.index + (end - written);
        next = Y.createRelativePositionFromTypeIndex(text, cursor, -1);
        written = end;
        edit.onProgress?.(cursor);
        if (written < change.insert.length) await clock.sleep(LIVE_TYPING.frameMs, signal);
      }

      const typedAt = start && Y.createAbsolutePositionFromRelativePosition(start, doc);
      return { ...change, index: typedAt?.index ?? change.index };
    },
  };
}
