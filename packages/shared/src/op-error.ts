/**
 * The origin tag and error type shared by every write in packages/shared.
 *
 * An OpError's message is written for the person who tried the action, so the
 * UI can show it as-is; the code is for tests and for UI logic that needs to
 * tell failures apart.
 */

/** Origin tag on every transaction the ops perform. */
export const OPS_ORIGIN = 'collabcode:ops';

export type OpErrorCode =
  | 'already-initialised'
  | 'invalid-name'
  | 'invalid-meta'
  | 'not-found'
  | 'invalid-parent'
  | 'duplicate-name'
  | 'would-create-cycle'
  | 'too-many-nodes'
  | 'too-many-nodes-total'
  | 'file-too-large';

export class OpError extends Error {
  readonly code: OpErrorCode;

  constructor(code: OpErrorCode, message: string) {
    super(message);
    this.name = 'OpError';
    this.code = code;
  }
}
