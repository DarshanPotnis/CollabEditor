/**
 * Follow mode for the person who started the AI teammate (follow-state.ts):
 * opens the file the agent is in and keeps its caret in view, from the agent's
 * own awareness state, read and parsed like any peer's. The caret is a
 * relative position, so it is found only once the agent's edit has reached
 * this document; every document update checks again. A file that is not in
 * the tree (deleted, or not arrived yet) is never followed into, and when the
 * agent deletes the file being followed, follow mode steps back out of it.
 */
import { parseAwarenessState, readFileText, type ResolvedTree } from '@collabcode/shared';
import { useCallback, useEffect, useReducer } from 'react';
import type * as Y from 'yjs';
import { isLocalTextEdit } from '../../collab/last-edit-publisher.js';
import { remoteCursorIndex } from '../../collab/remote-selection.js';
import type { ProjectSession } from '../../collab/useProject.js';
import { NOT_FOLLOWING, afterFollowedFileGone, followReducer } from './follow-state.js';

/** Scrolling at most this often keeps typing smooth without re-rendering on every piece. */
const REVEAL_EVERY_MS = 250;

export type FollowAgentOptions = {
  session: ProjectSession | null;
  /** The agent's awareness client while its session runs; null otherwise. */
  agentClientId: number | null;
  /** The file the person has shown. */
  shownFileId: string | null;
  tree: ResolvedTree;
  /** Whether the person has a tab open for the file. */
  isOpen: (fileId: string) => boolean;
  openFile: (fileId: string) => void;
  closeFile: (fileId: string) => void;
  reveal: (fileId: string, index: number) => void;
};

export type FollowAgent = { following: boolean; resume: () => void };

export function useFollowAgent({
  session,
  agentClientId,
  shownFileId,
  tree,
  isOpen,
  openFile,
  closeFile,
  reveal,
}: FollowAgentOptions): FollowAgent {
  const [state, dispatch] = useReducer(followReducer, NOT_FOLLOWING);

  useEffect(() => {
    dispatch({ type: agentClientId === null ? 'session-ended' : 'session-started' });
  }, [agentClientId]);

  useEffect(() => {
    dispatch({ type: 'file-shown', fileId: shownFileId });
  }, [shownFileId]);

  useEffect(() => {
    if (!session) return;
    const onTransaction = (transaction: Y.Transaction): void => {
      if (isLocalTextEdit(transaction)) dispatch({ type: 'person-typed' });
    };
    session.doc.on('afterTransaction', onTransaction);
    return () => session.doc.off('afterTransaction', onTransaction);
  }, [session]);

  useEffect(() => {
    const awareness = session?.provider.awareness;
    if (!session || !awareness || agentClientId === null || !state.following) return;
    let followedFile: string | null = null;
    let revealed: { fileId: string; index: number } | null = null;
    let lastRevealAt = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const check = (): void => {
      const raw = awareness.getStates().get(agentClientId);
      const fileId = parseAwarenessState(raw)?.activeFileId ?? null;
      if (fileId === null || !tree.byId.has(fileId)) return;
      if (fileId !== followedFile) {
        followedFile = fileId;
        dispatch({ type: 'followed-into', fileId, tabWasOpen: isOpen(fileId) });
        openFile(fileId);
      }
      const text = readFileText(session.doc, fileId);
      const index = text ? remoteCursorIndex(raw, text) : null;
      if (index === null || (revealed?.fileId === fileId && revealed.index === index)) return;
      const wait = lastRevealAt + REVEAL_EVERY_MS - Date.now();
      if (wait > 0) {
        pending ??= setTimeout(() => {
          pending = undefined;
          check();
        }, wait);
        return;
      }
      revealed = { fileId, index };
      lastRevealAt = Date.now();
      reveal(fileId, index);
    };

    check();
    awareness.on('change', check);
    session.doc.on('update', check);
    return () => {
      clearTimeout(pending);
      awareness.off('change', check);
      session.doc.off('update', check);
    };
  }, [session, agentClientId, state.following, tree, isOpen, openFile, reveal]);

  useEffect(() => {
    const next = afterFollowedFileGone(state, (fileId) => tree.byId.has(fileId));
    if (next === null) return;
    dispatch({ type: 'followed-file-gone', showing: next.show });
    if (next.close !== null) closeFile(next.close);
    if (next.show !== null) openFile(next.show);
  }, [state, tree, openFile, closeFile]);

  const resume = useCallback(() => dispatch({ type: 'resumed' }), []);
  return { following: state.following, resume };
}
