/**
 * Everyone currently in the project, validated. Awareness removes a client's
 * state when they leave, so a departing collaborator's avatar and cursor
 * disappear on their own.
 */
import { useEffect, useState } from 'react';
import type { AwarenessUser } from '@collabcode/shared';
import { parseCollaborators, type Collaborator } from './collaborators.js';
import type { ProjectSession } from './useProject.js';

export function useCollaborators(session: ProjectSession | null): Collaborator[] {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  useEffect(() => {
    const awareness = session?.provider.awareness;
    if (!session || !awareness) {
      setCollaborators([]);
      return;
    }

    const update = (): void => {
      setCollaborators(parseCollaborators(awareness.getStates(), session.doc.clientID));
    };

    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
    };
  }, [session]);

  return collaborators;
}

/** Publish who you are, and which file you are looking at. */
export function usePublishIdentity(
  session: ProjectSession | null,
  identity: AwarenessUser,
  activeFileId: string | null,
): void {
  useEffect(() => {
    if (!session) return;
    session.provider.setAwarenessField('user', identity);
    session.provider.setAwarenessField('activeFileId', activeFileId);
  }, [session, identity, activeFileId]);
}
