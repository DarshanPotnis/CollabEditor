/**
 * Turning raw awareness states into people we can render.
 *
 * Every entry comes from another browser via a server that does not inspect
 * it, so each one is parsed and anything malformed is dropped rather than
 * shown. Order is stable (by client id) so avatars do not shuffle on every
 * keystroke.
 */
import { parseAwarenessState, type AwarenessState, type AwarenessUser } from '@collabcode/shared';

export type Collaborator = {
  clientId: number;
  user: AwarenessUser;
  activeFileId: string | null;
  isYou: boolean;
};

export function parseCollaborators(
  states: Map<number, unknown>,
  localClientId: number,
): Collaborator[] {
  const collaborators: Collaborator[] = [];

  for (const [clientId, raw] of states) {
    const parsed: AwarenessState | null = parseAwarenessState(raw);
    if (!parsed) continue;
    collaborators.push({
      clientId,
      user: parsed.user,
      activeFileId: parsed.activeFileId,
      isYou: clientId === localClientId,
    });
  }

  return collaborators.sort((a, b) => a.clientId - b.clientId);
}

/** Everyone except you, which is what the remote cursors need. */
export function remoteOnly(collaborators: readonly Collaborator[]): Collaborator[] {
  return collaborators.filter((collaborator) => !collaborator.isYou);
}
