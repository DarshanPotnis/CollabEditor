/**
 * Running a tree op from the UI. A refused op throws OpError with a message
 * written for the user; that becomes a value the caller shows. Anything else
 * is a bug and keeps propagating to the pane's error boundary.
 */
import { OpError } from '@collabcode/shared';

export type OpResult<T> = { ok: true; value: T } | { ok: false; error: OpError };

export function runOp<T>(op: () => T): OpResult<T> {
  try {
    return { ok: true, value: op() };
  } catch (error) {
    if (error instanceof OpError) return { ok: false, error };
    throw error;
  }
}
