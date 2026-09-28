/**
 * "Undo AI changes": reverse everything one AI agent session wrote, and nothing
 * anyone else did (docs/PLAN-AI.md §3.3).
 *
 * - **Text** goes through a Y.UndoManager that tracks only the session's origin
 *   and is scoped to the files the agent edited. Characters a person typed
 *   inside the agent's text are separate CRDT items, so they survive.
 * - **Tree** changes are logged as the agent makes them and reversed newest
 *   first with the soft tree ops. A file the agent created is soft-deleted, so
 *   anything a person typed into it can still be restored from Recently
 *   deleted; a rename or move goes back only if nobody has changed the node
 *   since; a file the agent deleted is restored.
 *
 * An UndoManager over the whole `nodes` map would be simpler, but undoing a
 * create with it removes the node outright, and any human edits with it.
 */
import * as Y from 'yjs';
import { OpError } from './op-error.js';
import { nodesMap, readAllNodes, readFileText, readNode, type NodeFields } from './schema.js';
import {
  move,
  rename,
  resolveDocTree,
  restore,
  softDelete,
  type TreeOpContext,
} from './tree-ops.js';

/** Where a node sits: its folder (null for the root) and its name. */
export type NodePlace = { parentId: string | null; name: string };

export type AgentTreeAction =
  | { kind: 'created'; nodeId: string }
  | { kind: 'moved'; nodeId: string; from: NodePlace; to: NodePlace }
  | { kind: 'deleted'; nodeId: string };

export type AgentUndoPreview = {
  /** True when the session has written nothing that could be undone. */
  empty: boolean;
  /** Nodes the agent touched that someone else has changed since, in the order first seen. */
  changedByOthers: string[];
};

export type AgentUndoResult = {
  /** Files whose text had the agent's edits removed. */
  textFiles: number;
  /** Tree actions that were reversed. */
  treeActions: number;
  /** Tree actions left alone, with a reason a person can read. */
  skipped: Array<{ nodeId: string; reason: string }>;
};

export type AgentUndo = {
  /** Call before the agent first writes to a file's text, so the write is tracked. */
  trackEdit: (fileId: string) => void;
  /** Call after the agent created, moved or renamed, or deleted a node. */
  recordTreeAction: (action: AgentTreeAction) => void;
  preview: () => AgentUndoPreview;
  /** Reverse everything; `context` names the agent on anything it soft-deletes. */
  undo: (context: TreeOpContext) => AgentUndoResult;
  destroy: () => void;
};

type Outcome = { reversed: boolean } | { skipped: string };

const DONE: Outcome = { reversed: true };
const NOTHING_TO_DO: Outcome = { reversed: false };

function samePlace(node: NodeFields, place: NodePlace): boolean {
  return node.parentId === place.parentId && node.name === place.name;
}

function hasDeletedAncestor(doc: Y.Doc, node: NodeFields): boolean {
  const byId = new Map(readAllNodes(doc).map((entry) => [entry.id, entry]));
  const seen = new Set<string>([node.id]);
  let parent = node.parentId === null ? undefined : byId.get(node.parentId);
  while (parent && !seen.has(parent.id)) {
    if (parent.deletedAt !== null) return true;
    seen.add(parent.id);
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
  }
  return false;
}

function attempt(write: () => void): Outcome {
  try {
    write();
    return DONE;
  } catch (error) {
    if (error instanceof OpError) return { skipped: error.message };
    throw error;
  }
}

export function createAgentUndo(doc: Y.Doc, origin: unknown): AgentUndo {
  // Files join the scope as the agent first edits them.
  const textUndo = new Y.UndoManager([], { doc, trackedOrigins: new Set([origin]) });
  const trackedTexts = new Set<string>();
  const createdIds = new Set<string>();
  const log: AgentTreeAction[] = [];
  const watched = new Set<string>();
  const changedByOthers = new Set<string>();
  const unwatch: Array<() => void> = [];

  /** Remember when a change to this node's text or fields came from someone else. */
  const watch = (nodeId: string): void => {
    if (watched.has(nodeId)) return;
    watched.add(nodeId);
    const onChange = (_event: unknown, transaction: Y.Transaction): void => {
      if (!transaction.local) changedByOthers.add(nodeId);
    };
    for (const type of [readFileText(doc, nodeId), nodesMap(doc).get(nodeId)]) {
      if (!type) continue;
      type.observe(onChange);
      unwatch.push(() => type.unobserve(onChange));
    }
  };

  const reverseCreated = (nodeId: string, context: TreeOpContext): Outcome => {
    const tree = resolveDocTree(doc);
    const node = tree.byId.get(nodeId);
    if (!node) return NOTHING_TO_DO;
    if (node.kind === 'folder') {
      const prefix = `${node.path}/`;
      const addedByOthers = [...tree.byId.values()].some(
        (entry) => entry.path.startsWith(prefix) && !createdIds.has(entry.id),
      );
      if (addedByOthers) {
        return {
          skipped: `Kept the folder "${node.path}" because it has files someone else added.`,
        };
      }
    }
    return attempt(() => softDelete(doc, nodeId, context, origin));
  };

  const reverseMoved = (nodeId: string, from: NodePlace, to: NodePlace): Outcome => {
    const node = readNode(doc, nodeId);
    if (!node || !resolveDocTree(doc).byId.has(nodeId)) {
      return { skipped: 'It has been deleted since.' };
    }
    if (!samePlace(node, to)) return { skipped: 'Someone moved or renamed it since.' };
    return attempt(() => {
      if (node.name !== from.name) rename(doc, nodeId, from.name, origin);
      if (node.parentId !== from.parentId) move(doc, nodeId, from.parentId, origin);
    });
  };

  const reverseDeleted = (nodeId: string): Outcome => {
    const node = readNode(doc, nodeId);
    if (!node || node.deletedAt === null) return NOTHING_TO_DO;
    // Restoring would also bring back that folder, which someone else deleted.
    if (hasDeletedAncestor(doc, node)) {
      return { skipped: 'Its folder has been deleted since, so it was left in Recently deleted.' };
    }
    return attempt(() => restore(doc, nodeId, origin));
  };

  const reverse = (action: AgentTreeAction, context: TreeOpContext): Outcome => {
    switch (action.kind) {
      case 'created':
        return reverseCreated(action.nodeId, context);
      case 'moved':
        return reverseMoved(action.nodeId, action.from, action.to);
      case 'deleted':
        return reverseDeleted(action.nodeId);
    }
  };

  return {
    trackEdit(fileId) {
      const text = readFileText(doc, fileId);
      if (!text || trackedTexts.has(fileId)) return;
      trackedTexts.add(fileId);
      textUndo.addToScope(text);
      watch(fileId);
    },

    recordTreeAction(action) {
      log.push(action);
      if (action.kind === 'created') createdIds.add(action.nodeId);
      watch(action.nodeId);
    },

    preview() {
      return {
        empty: log.length === 0 && textUndo.undoStack.length === 0,
        changedByOthers: [...changedByOthers],
      };
    },

    undo(context) {
      const result: AgentUndoResult = { textFiles: 0, treeActions: 0, skipped: [] };
      for (const action of log.toReversed()) {
        const outcome = reverse(action, context);
        if ('skipped' in outcome)
          result.skipped.push({ nodeId: action.nodeId, reason: outcome.skipped });
        else if (outcome.reversed) result.treeActions += 1;
      }
      log.length = 0;

      if (textUndo.undoStack.length > 0) result.textFiles = trackedTexts.size;
      while (textUndo.undoStack.length > 0) textUndo.undo();
      return result;
    },

    destroy() {
      for (const stop of unwatch) stop();
      unwatch.length = 0;
      textUndo.destroy();
    },
  };
}
