/**
 * Who is in which file, for the agent's presence rule, read from the room's
 * awareness. Every state is parsed like any other peer data. Edit times are
 * kept on this browser's clock (peer-edit-times.ts), noted as changes arrive,
 * so a peer whose clock is off cannot make a file look busy or quiet.
 */
import { PRESENCE_WINDOW_MS, type PeerPresence, type PresenceSource } from '@collabcode/agent';
import { parseAwarenessState } from '@collabcode/shared';
import type { Awareness } from 'y-protocols/awareness';
import { createPeerEditTimes } from '../../collab/peer-edit-times.js';

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] };

export type AwarenessPresence = PresenceSource & { dispose: () => void };

export function createAwarenessPresence(
  awareness: Awareness,
  hostUserId: string,
  now: () => number,
): AwarenessPresence {
  const times = createPeerEditTimes(PRESENCE_WINDOW_MS);
  const note = (clientId: number): void => {
    const state = parseAwarenessState(awareness.getStates().get(clientId));
    times.note(clientId, state?.lastEditAt, now());
  };
  for (const clientId of awareness.getStates().keys()) note(clientId);

  const onChange = ({ added, updated, removed }: AwarenessChange): void => {
    for (const clientId of [...added, ...updated]) note(clientId);
    for (const clientId of removed) times.forget(clientId);
  };
  awareness.on('change', onChange);

  return {
    hostUserId,
    selfClientId: awareness.clientID,
    peers() {
      const peers: PeerPresence[] = [];
      for (const [clientId, raw] of awareness.getStates()) {
        const state = parseAwarenessState(raw);
        if (!state) continue;
        peers.push({
          clientId,
          userId: state.user.id,
          activeFileId: state.activeFileId,
          lastEditAt: times.lastEditAt(clientId),
        });
      }
      return peers;
    },
    dispose() {
      awareness.off('change', onChange);
    },
  };
}
