/**
 * Publishes when you last edited a file (throttled), for the AI agent's
 * presence rule: an agent leaves alone a file someone else is typing in.
 */
import { useEffect } from 'react';
import type * as Y from 'yjs';
import { createLastEditPublisher, isLocalTextEdit } from './last-edit-publisher.js';
import type { ProjectSession } from './useProject.js';

export function useLastEditPresence(session: ProjectSession | null): void {
  useEffect(() => {
    if (!session) return;
    const { doc, provider } = session;
    const edited = createLastEditPublisher(
      (at) => provider.setAwarenessField('lastEditAt', at),
      Date.now,
    );
    const onTransaction = (transaction: Y.Transaction): void => {
      if (isLocalTextEdit(transaction)) edited();
    };
    doc.on('afterTransaction', onTransaction);
    return () => doc.off('afterTransaction', onTransaction);
  }, [session]);
}
