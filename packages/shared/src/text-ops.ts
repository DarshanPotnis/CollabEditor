/**
 * The write path for file content when it does not come from a person typing.
 *
 * People's keystrokes reach a file's Y.Text through y-monaco, the one exception
 * in CLAUDE.md. An AI agent never has an editor, so its edits come through here
 * instead: they carry an origin (so "Undo AI changes" can find them), respect
 * the per-file limit the editor would otherwise enforce, and change only the
 * characters that really differ, so text a collaborator is typing next to an
 * edit is left where it is.
 */
import type * as Y from 'yjs';
import { MAX_FILE_SIZE } from './limits.js';
import { OpError } from './op-error.js';
import { readFileText } from './schema.js';

/** Delete `deleteCount` characters at `index`, then insert `insert` there. */
export type TextChange = { index: number; deleteCount: number; insert: string };

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Where `needle` starts, and how many times it occurs, overlaps included. */
function occurrences(content: string, needle: string): { first: number; count: number } {
  const first = content.indexOf(needle);
  let count = 0;
  for (let at = first; at !== -1; at = content.indexOf(needle, at + 1)) count += 1;
  return { first, count };
}

/**
 * How many leading and trailing characters two strings share, never ending
 * inside a surrogate pair: Yjs replaces half of a split pair with U+FFFD.
 */
function sharedEnds(a: string, b: string): { prefix: number; suffix: number } {
  const max = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < max && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix += 1;
  if (prefix > 0 && isHighSurrogate(a.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(a.charCodeAt(a.length - suffix))) suffix -= 1;
  return { prefix, suffix };
}

/**
 * The smallest change that turns the one occurrence of `oldText` in `content`
 * into `newText`. Refuses when `oldText` is missing or occurs more than once,
 * and when the result would pass the per-file limit (a change that shrinks an
 * oversized file is always allowed, as in the editor). `oldText` may be empty
 * only when the file is.
 */
export function planReplacement(content: string, oldText: string, newText: string): TextChange {
  let index = 0;
  if (oldText === '') {
    if (content !== '') {
      throw new OpError(
        'no-match',
        'The text to replace is empty. It can only be empty when the file is empty.',
      );
    }
  } else {
    const found = occurrences(content, oldText);
    if (found.count === 0) {
      throw new OpError(
        'no-match',
        'The text to replace is not in the file. It may have changed since it was read.',
      );
    }
    if (found.count > 1) {
      throw new OpError(
        'ambiguous-match',
        `The text to replace appears ${String(found.count)} times in the file. Include more of the surrounding lines so it matches exactly once.`,
      );
    }
    index = found.first;
  }

  const { prefix, suffix } = sharedEnds(oldText, newText);
  const change: TextChange = {
    index: index + prefix,
    deleteCount: oldText.length - prefix - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
  const resulting = content.length - change.deleteCount + change.insert.length;
  if (resulting > MAX_FILE_SIZE && resulting > content.length) {
    throw new OpError(
      'file-too-large',
      `That edit would take the file over the ${String(Math.round(MAX_FILE_SIZE / 1024))} KB limit for one file.`,
    );
  }
  return change;
}

/**
 * Replace the one occurrence of `oldText` in a file with `newText`, in one
 * transaction tagged with `origin`. Returns the change that was applied, so the
 * caller can place a cursor after it.
 */
export function replaceText(
  doc: Y.Doc,
  fileId: string,
  oldText: string,
  newText: string,
  origin: unknown,
): TextChange {
  const text = fileText(doc, fileId);
  const change = planReplacement(text.toJSON(), oldText, newText);
  if (change.deleteCount === 0 && change.insert === '') return change;

  doc.transact(() => {
    if (change.deleteCount > 0) text.delete(change.index, change.deleteCount);
    if (change.insert !== '') text.insert(change.index, change.insert);
  }, origin);
  return change;
}

function fileText(doc: Y.Doc, fileId: string): Y.Text {
  const text = readFileText(doc, fileId);
  if (!text) throw new OpError('not-found', 'That file no longer exists.');
  return text;
}

/**
 * Insert `insert` at `index`, one piece of an edit being typed in live. Checks
 * the per-file limit again, since others may have added text since the edit
 * was planned.
 */
export function insertText(
  doc: Y.Doc,
  fileId: string,
  index: number,
  insert: string,
  origin: unknown,
): void {
  const text = fileText(doc, fileId);
  if (text.length + insert.length > MAX_FILE_SIZE) {
    throw new OpError(
      'file-too-large',
      `The file reached the ${String(Math.round(MAX_FILE_SIZE / 1024))} KB limit for one file part way through the edit.`,
    );
  }
  doc.transact(() => text.insert(Math.min(index, text.length), insert), origin);
}

/** Delete `deleteCount` characters at `index`, the first part of an edit typed in live. */
export function deleteText(
  doc: Y.Doc,
  fileId: string,
  index: number,
  deleteCount: number,
  origin: unknown,
): void {
  const text = fileText(doc, fileId);
  if (deleteCount === 0) return;
  doc.transact(() => text.delete(index, deleteCount), origin);
}
