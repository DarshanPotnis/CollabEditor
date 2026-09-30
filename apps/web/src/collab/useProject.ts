/**
 * The Y.Doc and its provider, tied to the lifetime of the component.
 *
 * Both are created inside the effect and destroyed in its cleanup, so React
 * StrictMode's double invocation produces two complete create/destroy cycles
 * rather than a leaked socket (which is exactly what the old Socket.IO version
 * got wrong).
 */
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { config } from '../lib/app-config.js';
import {
  INITIAL_CONNECTION_STATE,
  WAKING_AFTER_MS,
  nextConnectionState,
  type ConnectionEvent,
  type ConnectionState,
} from './connection-state.js';

export type ProjectSession = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
};

export type UseProjectResult = {
  session: ProjectSession | null;
  connection: ConnectionState;
  /**
   * Whether the document has had its first sync from the server. The session
   * exists before that, with an empty document, so anything that reads the
   * project's content once (such as a replay's check) must wait for this. It
   * stays true through reconnects: the document keeps what it had.
   */
  hasSynced: boolean;
};

export function useProject(projectId: string): UseProjectResult {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(INITIAL_CONNECTION_STATE);
  const [hasSynced, setHasSynced] = useState(false);

  useEffect(() => {
    let live = true;
    const dispatch = (event: ConnectionEvent): void => {
      if (live) setConnection((current) => nextConnectionState(current, event));
    };

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: config.collabUrl,
      name: projectId,
      document: doc,
      onSynced: ({ state }) => {
        if (!state) return;
        dispatch({ type: 'synced' });
        if (live) setHasSynced(true);
      },
      onDisconnect: ({ event }) => dispatch({ type: 'disconnected', code: event.code }),
      onAuthenticationFailed: ({ reason }) => dispatch({ type: 'refused', reason }),
    });

    // A first connection that takes this long is almost always Render waking
    // up, which deserves an explanation rather than a spinner.
    const wakingTimer = window.setTimeout(() => dispatch({ type: 'slow-start' }), WAKING_AFTER_MS);

    const onOffline = (): void => dispatch({ type: 'browser-offline' });
    const onOnline = (): void => dispatch({ type: 'browser-online' });
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    setSession({ doc, provider });
    setConnection(INITIAL_CONNECTION_STATE);
    setHasSynced(false);

    return () => {
      live = false;
      window.clearTimeout(wakingTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      provider.destroy();
      doc.destroy();
      setSession(null);
    };
  }, [projectId]);

  return { session, connection, hasSynced };
}
