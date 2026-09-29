/**
 * Size and count limits shared by the client and the server.
 *
 * The client enforces these so a user gets a friendly message before a write
 * happens. The server enforces the transport limit as a backstop because a
 * client can always be modified or out of date.
 */

/** Largest content a single file may hold, in UTF-16 code units. */
export const MAX_FILE_SIZE = 512 * 1024;

/** Most files and folders a project may show at once. */
export const MAX_LIVE_NODES = 500;

/**
 * Most nodes a project may hold including deleted ones, whose content is kept
 * so a delete can be undone. Without this, create-and-delete churn would grow
 * the document forever.
 */
export const MAX_TOTAL_NODES = 2_000;

/** Largest node name, in characters. */
export const MAX_NAME_LENGTH = 100;

/** Largest project name, in characters. */
export const MAX_PROJECT_NAME_LENGTH = 80;

/** Largest display name a collaborator may broadcast through awareness. */
export const MAX_USER_NAME_LENGTH = 32;

/** Largest status line an AI agent may broadcast through awareness. */
export const MAX_AGENT_STATUS_LENGTH = 80;

/**
 * Largest single WebSocket frame the collab server accepts.
 *
 * This is a transport safety net, not the file-size rule: one frame can carry
 * a whole document's initial sync, many files at once, or a large paste, so it
 * has to be far above MAX_FILE_SIZE. The real per-file limit is enforced at the
 * editor, where a human can be told what went wrong.
 */
export const MAX_TRANSPORT_PAYLOAD = 8 * 1024 * 1024;

/** Is a file's content within the per-file limit? Measured in UTF-16 units. */
export function isWithinFileSizeLimit(length: number): boolean {
  return length <= MAX_FILE_SIZE;
}

/** The message shown to whoever pushed a file over the limit. */
export function fileSizeLimitMessage(): string {
  return `This file has reached the ${Math.round(MAX_FILE_SIZE / 1024)} KB limit. Delete some content to keep editing.`;
}
