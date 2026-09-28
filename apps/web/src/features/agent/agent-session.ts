/**
 * One AI teammate session in the browser, from the parts built elsewhere
 * (docs/PLAN-AI.md §2):
 *
 *   agent-peer        its own Y.Doc and connection, so its edits are remote edits
 *   agent-presence    its avatar, status and caret in the room
 *   file tools        the core's, over the agent's own Y.Doc
 *   runtime-tools     the person's WebContainer, behind the settle barrier
 *   http-model-client the model, through the server
 *   runAgent          the core's loop
 *
 * The agent stays in the room after it finishes, with its status saying so,
 * until the person dismisses it: "Undo AI changes" writes through its
 * connection, so the undo exists only while the agent does.
 */
import {
  AGENT_LIMITS,
  composeToolHost,
  createDocTools,
  createStopSource,
  runAgent,
  type AgentEvent,
  type AgentOutcome,
  type AgentRunResult,
  type AgentTrace,
  type Typist,
} from '@collabcode/agent';
import {
  agentOrigin,
  createAgentUndo,
  createNodeId,
  resolveDocTree,
  type AgentUndoResult,
} from '@collabcode/shared';
import type * as Y from 'yjs';
import type { OwnKey } from '../ai/byok-store.js';
import { sendRequest } from '../runtime/api-console/send-request.js';
import { agentInputs, startingProject } from './agent-inputs.js';
import { connectAgentPeer } from './agent-peer.js';
import { AGENT_NAME, agentUser, publishAgentPresence } from './agent-presence.js';
import { AGENT_STATUS, toolStatus } from './agent-status.js';
import { createAwarenessPresence } from './awareness-presence.js';
import { waitForEditsOf } from './doc-sync.js';
import { createHttpModelClient } from './http-model-client.js';
import { createRuntimeTools, type AgentRuntime } from './runtime-tools.js';
import { systemClock } from './system-clock.js';

export type AgentSessionDeps = {
  projectId: string;
  collabUrl: string;
  apiUrl: string;
  /** The person's own document, which the running project is fed from. */
  hostDoc: Y.Doc;
  host: { userId: string; name: string };
  runtime: AgentRuntime;
  /** Fixed for the session. */
  ownKey: OwnKey | null;
  typist: Typist;
  onEvent: (event: AgentEvent) => void;
  onNotice: (message: string) => void;
};

export type UndoPreview = { empty: boolean; changedPaths: string[] };
export type UndoSummary = { summary: string; skipped: string[] };

export type AgentSession = {
  sessionId: string;
  /** The agent's awareness client in the room, which follow mode watches. */
  clientId: number;
  maxSteps: number;
  /** Starts the loop; call once, after showing that the session has started. */
  run: () => Promise<AgentRunResult>;
  stop: () => void;
  undoPreview: () => UndoPreview;
  undo: () => UndoSummary;
  /** The session's trace, once it has ended. */
  trace: () => AgentTrace | null;
  /** Leaves the room; "Undo AI changes" goes with it. */
  dismiss: () => void;
};

function statusAfter(outcome: AgentOutcome): string {
  return outcome.kind === 'finished' ? AGENT_STATUS.finished : AGENT_STATUS.stopped;
}

function count(value: number, one: string, many: string): string {
  return `${String(value)} ${value === 1 ? one : many}`;
}

/** "Undid the AI's changes in 2 files, and 1 change to the file tree." */
export function describeUndo(result: AgentUndoResult): string {
  const parts: string[] = [];
  if (result.textFiles > 0) parts.push(`in ${count(result.textFiles, 'file', 'files')}`);
  if (result.treeActions > 0) {
    parts.push(`${count(result.treeActions, 'change', 'changes')} to the file tree`);
  }
  if (parts.length === 0) return 'There was nothing left to undo.';
  return `Undid the AI's changes ${parts.join(', and ')}.`;
}

export async function startAgentSession(
  goal: string,
  deps: AgentSessionDeps,
  signal: AbortSignal,
): Promise<AgentSession> {
  const sessionId = createNodeId();
  const peer = await connectAgentPeer({ url: deps.collabUrl, projectId: deps.projectId, signal });
  const presence = publishAgentPresence({
    awareness: peer.awareness,
    doc: peer.doc,
    sessionId,
    host: deps.host,
    now: Date.now,
  });
  const origin = agentOrigin(sessionId);
  const undo = createAgentUndo(peer.doc, origin);
  const actor = { userId: agentUser(sessionId).id, userName: AGENT_NAME };
  const peers = createAwarenessPresence(peer.awareness, deps.host.userId, Date.now);
  const tools = composeToolHost(
    createDocTools({
      doc: peer.doc,
      origin,
      actor,
      undo,
      presence: peers,
      typist: deps.typist,
      now: Date.now,
      onActivity: (activity) => presence.showActivity(activity),
    }),
    createRuntimeTools({
      runtime: deps.runtime,
      docSynced: (waitSignal) => waitForEditsOf(peer.doc, deps.hostDoc, waitSignal),
      sendRequest,
      onNotice: deps.onNotice,
      now: Date.now,
    }),
  );
  const tier = deps.ownKey === null ? 'shared' : 'ownKey';
  const stop = createStopSource();
  let trace: AgentTrace | null = null;

  const onEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case 'step-started':
        presence.setStatus(AGENT_STATUS.thinking);
        break;
      case 'waiting':
        presence.setStatus(event.reason === 'busy' ? AGENT_STATUS.busy : AGENT_STATUS.rateLimited);
        break;
      case 'tool-started':
        presence.setStatus(toolStatus(event.toolName, event.input));
        break;
      default:
        break;
    }
    deps.onEvent(event);
  };

  const run = async (): Promise<AgentRunResult> => {
    const result = await runAgent({
      sessionId,
      inputs: agentInputs(peer.doc, goal),
      tier,
      model: createHttpModelClient({
        apiUrl: deps.apiUrl,
        projectId: deps.projectId,
        sessionId,
        ownKey: deps.ownKey,
      }),
      tools,
      clock: systemClock,
      stop: stop.signal,
      project: startingProject(peer.doc),
      onEvent,
    });
    trace = result.trace;
    presence.setStatus(statusAfter(result.outcome));
    presence.clearCursor();
    return result;
  };

  const pathOf = (nodeId: string): string => {
    const tree = resolveDocTree(peer.doc);
    return tree.byId.get(nodeId)?.path ?? tree.hidden.get(nodeId)?.name ?? 'a file';
  };

  return {
    sessionId,
    clientId: peer.awareness.clientID,
    maxSteps: AGENT_LIMITS[tier].maxSteps,
    run,
    stop: () => stop.stop(),
    undoPreview() {
      const preview = undo.preview();
      return { empty: preview.empty, changedPaths: preview.changedByOthers.map(pathOf) };
    },
    undo() {
      const result = undo.undo({ ...actor, now: Date.now() });
      presence.setStatus(AGENT_STATUS.undone);
      return {
        summary: describeUndo(result),
        skipped: result.skipped.map(({ nodeId, reason }) => `${pathOf(nodeId)}: ${reason}`),
      };
    },
    trace: () => trace,
    dismiss() {
      stop.stop();
      peers.dispose();
      undo.destroy();
      peer.destroy();
    },
  };
}
