/**
 * How the collab server refuses a document.
 *
 * Hocuspocus turns a rejection from a document hook into a permission-denied
 * message carrying `error.reason`, which the provider surfaces through its
 * onAuthenticationFailed callback. The reason strings are therefore part of
 * the client contract, not just log text.
 */
export const COLLAB_REJECTION_REASONS = {
  invalidProjectId: 'invalid-project-id',
  projectNotFound: 'project-not-found',
} as const;

export type CollabRejectionReason =
  (typeof COLLAB_REJECTION_REASONS)[keyof typeof COLLAB_REJECTION_REASONS];

export class CollabRejectionError extends Error {
  readonly reason: CollabRejectionReason;

  constructor(reason: CollabRejectionReason, message: string) {
    super(message);
    this.name = 'CollabRejectionError';
    this.reason = reason;
  }
}
