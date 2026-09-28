/**
 * The presence rule (docs/PLAN-AI.md §4): the agent does not change a file
 * that someone else is working in right now. It lives here, in the ToolHost's
 * path, not only in the prompt, so it holds even when the model ignores its
 * instructions.
 *
 * "Someone else" is every peer other than the person who started the agent
 * and the agent itself, other agents included. Nothing here trusts a peer's
 * claim to be an agent: awareness is unauthenticated, and a claim may only
 * ever make the agent more careful, never less.
 */

/** How recent an edit must be for its file to count as busy. */
export const PRESENCE_WINDOW_MS = 30_000;

export type PeerPresence = {
  clientId: number;
  userId: string;
  activeFileId: string | null;
  /** When this peer last edited, on the reader's own clock; null when never seen editing. */
  lastEditAt: number | null;
};

export type PresenceSource = {
  /** The person the agent works for: their own open files are fair game. */
  hostUserId: string;
  /** The agent's own awareness client, which never blocks itself. */
  selfClientId: number;
  peers: () => readonly PeerPresence[];
};

/** Whether someone other than the host or the agent is editing `fileId` right now. */
export function someoneElseEditing(source: PresenceSource, fileId: string, now: number): boolean {
  return source
    .peers()
    .some(
      (peer) =>
        peer.clientId !== source.selfClientId &&
        peer.userId !== source.hostUserId &&
        peer.activeFileId === fileId &&
        peer.lastEditAt !== null &&
        now - peer.lastEditAt < PRESENCE_WINDOW_MS,
    );
}

/** What the model is told. No name: a peer's name is text a stranger chose. */
export function busyFileMessage(path: string): string {
  return `Someone else is editing ${path} right now, so leave it alone. Say in your summary what you would change there.`;
}
