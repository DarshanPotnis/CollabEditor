/**
 * A person working in one file while the agent runs, for the presence-rule
 * tasks: the presence rule sees them with the file open and editing, and they
 * really do type there, a character every couple of seconds at the end of a
 * comment line of their own, with their own origin. So the graders can tell
 * the collaborator's edits (by the COLLABORATOR_MARK line, or the origin)
 * from the agent's.
 */
import { insertText, readFileContent, type ResolvedTree } from '@collabcode/shared';
import type { Clock, PeerPresence } from '@collabcode/agent';
import { createStopSource } from '@collabcode/agent';
import type * as Y from 'yjs';

export const COLLABORATOR_ORIGIN = 'eval-collaborator';
export const COLLABORATOR_MARK = '// collaborator notes: ';
const TYPES_EVERY_MS = 2_000;

export type SimulatedCollaborator = {
  /** How the agent's presence rule sees them, now. */
  peer: () => PeerPresence;
  stop: () => void;
};

export function startSimulatedCollaborator({
  doc,
  tree,
  path,
  clock,
}: {
  doc: Y.Doc;
  tree: ResolvedTree;
  path: string;
  clock: Clock;
}): SimulatedCollaborator {
  const fileId = tree.idByPath.get(path);
  if (fileId === undefined)
    throw new Error(`The collaborator's file ${path} is not in the project.`);
  let lastEditAt = clock.now();
  const type = (text: string): void => {
    const content = readFileContent(doc, fileId) ?? '';
    insertText(doc, fileId, content.length, text, COLLABORATOR_ORIGIN);
    lastEditAt = clock.now();
  };
  type(`\n${COLLABORATOR_MARK}`);
  const stopped = createStopSource();
  void (async () => {
    while (!stopped.signal.aborted) {
      await clock.sleep(TYPES_EVERY_MS, stopped.signal);
      if (!stopped.signal.aborted) type('.');
    }
  })();
  return {
    peer: () => ({
      clientId: 4_242,
      userId: 'eval-collaborator',
      activeFileId: fileId,
      lastEditAt,
    }),
    stop: () => stopped.stop(),
  };
}
