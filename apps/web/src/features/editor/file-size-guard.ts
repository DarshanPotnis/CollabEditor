/**
 * The per-file size limit, enforced where a human can be told about it.
 *
 * Editor keystrokes go through y-monaco straight into the file's Y.Text and
 * never pass through packages/shared's ops, so ops.ts cannot enforce this. The
 * server's maxPayload is a transport safety net at a much higher threshold, and
 * hitting it kills the socket rather than explaining anything.
 *
 * Brute force on purpose: once a file is at the limit we stop insertions and
 * oversized pastes, and deletions keep working so the file can be brought back
 * under. A remote collaborator can still push a file past the limit; their own
 * editor stops them first, and if a merge lands over the line everyone simply
 * cannot add more until someone deletes something.
 */
import { MAX_FILE_SIZE, fileSizeLimitMessage, isWithinFileSizeLimit } from '@collabcode/shared';

export type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

export { MAX_FILE_SIZE, fileSizeLimitMessage };

export function isAtFileSizeLimit(length: number): boolean {
  return !isWithinFileSizeLimit(length);
}

/**
 * Would this keypress add characters? Modified keys are shortcuts (copy,
 * save, undo), not text, and must keep working at the limit.
 */
export function isTextInsertingKey(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === 'Enter' || event.key === 'Tab') return true;
  // Named keys (Backspace, ArrowLeft, F5) are longer than one code point.
  return Array.from(event.key).length === 1;
}

export function pasteWouldExceedLimit(currentLength: number, pasted: string): boolean {
  return !isWithinFileSizeLimit(currentLength + pasted.length);
}

/** How much more the file can hold, never negative. */
export function remainingCharacters(currentLength: number): number {
  return Math.max(0, MAX_FILE_SIZE - currentLength);
}
