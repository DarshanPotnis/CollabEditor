/**
 * The agent's own CRDT peer (docs/PLAN-AI.md §2, ADR 008): a second Y.Doc in
 * the person's tab, with its own Hocuspocus connection. It therefore has its
 * own Yjs client id and awareness state, and its edits reach everyone, the
 * person who started it included, as remote edits. The sync layer needs no
 * special case, and the person's own connection is never touched.
 *
 * A separate WebSocket rather than Hocuspocus 4's session multiplexing: that
 * would need the person's provider to change too, and a problem on one
 * connection (a closed socket, an oversized frame) would take down both.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

/** How long the agent's first sync may take before starting is given up. */
export const AGENT_SYNC_TIMEOUT_MS = 20_000;

export class AgentPeerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentPeerError';
  }
}

export type AgentPeer = {
  doc: Y.Doc;
  awareness: Awareness;
  /** Leaves the room: its avatar and caret disappear for everyone. */
  destroy: () => void;
};

export type ConnectAgentPeerOptions = {
  url: string;
  projectId: string;
  signal: AbortSignal;
  timeoutMs?: number;
};

/** Connects and resolves once the agent's replica has the whole project. */
export function connectAgentPeer({
  url,
  projectId,
  signal,
  timeoutMs = AGENT_SYNC_TIMEOUT_MS,
}: ConnectAgentPeerOptions): Promise<AgentPeer> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    let settled = false;
    const cleanUp = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanUp();
      provider.destroy();
      doc.destroy();
      reject(new AgentPeerError(message));
    };
    const provider = new HocuspocusProvider({
      url,
      name: projectId,
      document: doc,
      onSynced: ({ state }) => {
        if (!state || settled) return;
        const awareness = provider.awareness;
        if (!awareness) {
          fail('The AI teammate could not join the room.');
          return;
        }
        settled = true;
        cleanUp();
        resolve({
          doc,
          awareness,
          destroy: () => {
            awareness.setLocalState(null);
            provider.destroy();
            doc.destroy();
          },
        });
      },
      onAuthenticationFailed: () => fail("The server refused the AI teammate's connection."),
    });
    const timer = setTimeout(
      () => fail('The AI teammate could not connect. Check your connection and try again.'),
      timeoutMs,
    );
    const onAbort = (): void => fail('Stopped.');
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
