/**
 * The agent's presence in the room: its own awareness state, published from
 * its own connection, so everyone sees an avatar, a status and a caret that
 * are not the person's who started it.
 *
 * The caret uses y-monaco's own `selection` field (relative positions in the
 * file's Y.Text), so every editor already draws it, in the file it is in.
 */
import {
  AGENT_TOOL_NAMES,
  MAX_AGENT_STATUS_LENGTH,
  presenceColorFor,
  readFileText,
  type AgentInfo,
  type AwarenessUser,
} from '@collabcode/shared';
import type { DocActivity } from '@collabcode/agent';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { AGENT_STATUS } from './agent-status.js';

export const AGENT_NAME = 'AI teammate';

export function agentUser(sessionId: string): AwarenessUser {
  const id = `agent-${sessionId}`;
  return { id, name: AGENT_NAME, color: presenceColorFor(id), kind: 'agent' };
}

export type AgentPresence = {
  setStatus: (status: string) => void;
  /** Moves the agent into the file it is working on, and its caret to where it edited. */
  showActivity: (activity: DocActivity) => void;
  clearCursor: () => void;
};

export type AgentPresenceOptions = {
  awareness: Awareness;
  /** The agent's own replica, whose texts the caret positions point into. */
  doc: Y.Doc;
  sessionId: string;
  host: { userId: string; name: string };
  now: () => number;
};

/** Tools that change a file, which is what `lastEditAt` reports. */
const EDITING_TOOLS: ReadonlySet<string> = new Set(['edit_file', 'create_file']);

export function publishAgentPresence({
  awareness,
  doc,
  sessionId,
  host,
  now,
}: AgentPresenceOptions): AgentPresence {
  let agent: AgentInfo = {
    hostUserId: host.userId,
    hostName: host.name,
    sessionId,
    status: AGENT_STATUS.starting,
  };
  awareness.setLocalState({ user: agentUser(sessionId), activeFileId: null, agent });

  const caretAt = (fileId: string, index: number): unknown => {
    const text = readFileText(doc, fileId);
    if (!text) return null;
    const position = Y.createRelativePositionFromTypeIndex(text, Math.min(index, text.length));
    return { anchor: position, head: position };
  };

  return {
    setStatus(status) {
      agent = { ...agent, status: Array.from(status).slice(0, MAX_AGENT_STATUS_LENGTH).join('') };
      awareness.setLocalStateField('agent', agent);
    },
    showActivity({ tool, fileId, cursor }) {
      if (!(AGENT_TOOL_NAMES as readonly string[]).includes(tool)) return;
      if (fileId === null) {
        if (tool === 'delete_file' || tool === 'rename_file') {
          awareness.setLocalStateField('activeFileId', null);
          awareness.setLocalStateField('selection', null);
        }
        return;
      }
      awareness.setLocalStateField('activeFileId', fileId);
      awareness.setLocalStateField('selection', cursor === null ? null : caretAt(fileId, cursor));
      if (EDITING_TOOLS.has(tool)) awareness.setLocalStateField('lastEditAt', now());
    },
    clearCursor() {
      awareness.setLocalStateField('selection', null);
    },
  };
}
