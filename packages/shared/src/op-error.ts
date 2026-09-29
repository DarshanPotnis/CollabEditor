/**
 * The origin tag and error type shared by every write in packages/shared.
 *
 * An OpError's message is written for the person who tried the action, so the
 * UI can show it as-is; the code is for tests and for UI logic that needs to
 * tell failures apart.
 */

/** Origin tag on every transaction the ops perform for a person. */
export const OPS_ORIGIN = 'collabcode:ops';

/**
 * Origin tag for one AI agent session. Everything the agent writes carries it,
 * so "Undo AI changes" can track exactly that session's edits and nothing else.
 */
export function agentOrigin(sessionId: string): string {
  return `collabcode:agent:${sessionId}`;
}

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
  | 'file-too-large'
  | 'no-match'
  | 'ambiguous-match';

export class OpError extends Error {
  readonly code: OpErrorCode;

  constructor(code: OpErrorCode, message: string) {
    super(message);
    this.name = 'OpError';
    this.code = code;
  }
}
