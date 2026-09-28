/**
 * When each peer last edited, on this browser's clock. A peer's `lastEditAt`
 * is a time by its own clock, which can be off by minutes; what this browser
 * can trust is when it saw the value change. On first sight (someone who was
 * already here), the peer's own time counts only when it looks recent by this
 * clock too.
 */

export type PeerEditTimes = {
  /** Record what a peer's awareness says now. */
  note: (clientId: number, lastEditAt: number | undefined, now: number) => void;
  /** When that peer last edited, on this clock, or null when not seen editing. */
  lastEditAt: (clientId: number) => number | null;
  forget: (clientId: number) => void;
};

export function createPeerEditTimes(recentMs: number): PeerEditTimes {
  const seen = new Map<number, { value: number; at: number | null }>();
  return {
    note(clientId, lastEditAt, now) {
      if (lastEditAt === undefined) {
        seen.delete(clientId);
        return;
      }
      const prior = seen.get(clientId);
      if (prior?.value === lastEditAt) return;
      const at =
        prior !== undefined
          ? now
          : Math.abs(now - lastEditAt) < recentMs
            ? Math.min(now, lastEditAt)
            : null;
      seen.set(clientId, { value: lastEditAt, at });
    },
    lastEditAt: (clientId) => seen.get(clientId)?.at ?? null,
    forget(clientId) {
      seen.delete(clientId);
    },
  };
}
