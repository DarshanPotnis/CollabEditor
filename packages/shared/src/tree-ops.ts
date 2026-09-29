/**
 * The write path for the file tree. Every op resolves the current tree, checks
 * the write against tree-rules.ts and the limits, and then changes the
 * document inside one `doc.transact(…, origin)`. The origin is OPS_ORIGIN for a
 * person and `agentOrigin(sessionId)` for an AI agent session.
 *
 * A refused write throws an OpError whose message can be shown to the user
 * as-is. The checks see only this client's copy, so two people doing the same
 * thing at the same moment can still collide; resolve-tree.ts handles that.
 */
import type * as Y from 'yjs';
import { createNodeId } from './ids.js';
import { MAX_FILE_SIZE, MAX_LIVE_NODES, MAX_TOTAL_NODES } from './limits.js';
import { insertNode } from './node-writer.js';
import { OPS_ORIGIN, OpError } from './op-error.js';
import { resolveTree, type ResolvedNode, type ResolvedTree } from './resolve-tree.js';
import {
  nodeNameSchema,
  nodesMap,
  readAllNodes,
  type NodeFields,
  type NodeKind,
} from './schema.js';
import { findNameClash, freeName, moveProblem } from './tree-rules.js';

export type TreeOpContext = {
  /** Awareness user id of whoever is acting. */
  userId: string;
  /** Their display name, recorded on deletes so it outlives their session. */
  userName: string;
  /** Injectable clock so tests are deterministic. */
  now?: number;
};

export type CreateNodeInput = {
  /** null for the project root. */
  parentId: string | null;
  name: string;
};

export type CreateFileInput = CreateNodeInput & { content?: string };

export type RestoreResult = {
  /** Every node whose tombstone was cleared: the target and deleted ancestors. */
  restoredIds: string[];
  /** Restored nodes that had to take a new name because theirs was taken. */
  renamed: Array<{ id: string; from: string; to: string }>;
};

/** The tree as this client currently sees it. */
export function resolveDocTree(doc: Y.Doc): ResolvedTree {
  return resolveTree(readAllNodes(doc));
}

function kindLabel(kind: NodeKind): string {
  return kind === 'file' ? 'file' : 'folder';
}

function whereLabel(tree: ResolvedTree, parentId: string | null): string {
  if (parentId === null) return 'the project root';
  return tree.byId.get(parentId)?.path ?? 'that folder';
}

function validName(raw: string): string {
  const name = raw.normalize('NFC');
  const parsed = nodeNameSchema.safeParse(name);
  if (!parsed.success) {
    const reason = parsed.error.issues[0]?.message ?? 'it is not allowed';
    throw new OpError('invalid-name', `"${raw}" can't be used as a name: ${reason}.`);
  }
  return parsed.data;
}

function duplicateNameError(
  tree: ResolvedTree,
  parentId: string | null,
  name: string,
  clash: ResolvedNode,
): OpError {
  const where = whereLabel(tree, parentId);
  const message =
    clash.name === name || clash.displayName === name
      ? `A ${kindLabel(clash.kind)} named "${name}" already exists in ${where}.`
      : `"${name}" clashes with "${clash.displayName}" in ${where}. Names that differ only in capitalisation are the same file on macOS and Windows.`;
  return new OpError('duplicate-name', message);
}

const notFound = (): OpError => new OpError('not-found', 'That file or folder no longer exists.');

const invalidParent = (): OpError =>
  new OpError('invalid-parent', 'The folder you chose no longer exists.');

function requireVisible(tree: ResolvedTree, nodeId: string): ResolvedNode {
  const node = tree.byId.get(nodeId);
  if (!node) throw notFound();
  return node;
}

function requireFolderOrRoot(tree: ResolvedTree, parentId: string | null): void {
  if (parentId !== null && tree.byId.get(parentId)?.kind !== 'folder') throw invalidParent();
}

function requireRoomForOneMore(doc: Y.Doc, tree: ResolvedTree): void {
  if (tree.byId.size >= MAX_LIVE_NODES) {
    throw new OpError(
      'too-many-nodes',
      `This project has reached its limit of ${String(MAX_LIVE_NODES)} files and folders. Delete something to make room.`,
    );
  }
  if (nodesMap(doc).size >= MAX_TOTAL_NODES) {
    throw new OpError(
      'too-many-nodes-total',
      `This project has reached its limit of ${MAX_TOTAL_NODES.toLocaleString('en')} files and folders, counting deleted ones that are kept so they can be restored. Permanently delete some in Recently deleted to make room.`,
    );
  }
}

function createNode(
  doc: Y.Doc,
  kind: NodeKind,
  input: CreateNodeInput,
  context: TreeOpContext,
  origin: unknown,
  content?: string,
): string {
  const tree = resolveDocTree(doc);
  const name = validName(input.name);
  requireFolderOrRoot(tree, input.parentId);
  const clash = findNameClash(tree, input.parentId, name);
  if (clash) throw duplicateNameError(tree, input.parentId, name, clash);
  requireRoomForOneMore(doc, tree);

  const id = createNodeId();
  doc.transact(() => {
    insertNode(
      doc,
      {
        id,
        kind,
        name,
        parentId: input.parentId,
        createdAt: context.now ?? Date.now(),
        createdBy: context.userId,
        deletedAt: null,
        deletedBy: null,
        deletedByName: null,
      },
      content,
    );
  }, origin);
  return id;
}

/** Create a file and return its id. */
export function createFile(
  doc: Y.Doc,
  input: CreateFileInput,
  context: TreeOpContext,
  origin: unknown = OPS_ORIGIN,
): string {
  const content = input.content ?? '';
  if (content.length > MAX_FILE_SIZE) {
    throw new OpError(
      'file-too-large',
      `That content is over the ${String(Math.round(MAX_FILE_SIZE / 1024))} KB limit for one file.`,
    );
  }
  return createNode(doc, 'file', input, context, origin, content);
}

/** Create a folder and return its id. */
export function createFolder(
  doc: Y.Doc,
  input: CreateNodeInput,
  context: TreeOpContext,
  origin: unknown = OPS_ORIGIN,
): string {
  return createNode(doc, 'folder', input, context, origin);
}

/** Rename a visible node. Renaming to its current name does nothing. */
export function rename(
  doc: Y.Doc,
  nodeId: string,
  rawName: string,
  origin: unknown = OPS_ORIGIN,
): void {
  const tree = resolveDocTree(doc);
  const node = requireVisible(tree, nodeId);
  const name = validName(rawName);
  if (name === node.name) return;
  const clash = findNameClash(tree, node.parentId, name, nodeId);
  if (clash) throw duplicateNameError(tree, node.parentId, name, clash);

  doc.transact(() => {
    nodesMap(doc).get(nodeId)?.set('name', name);
  }, origin);
}

/** Move a visible node into a folder, or to the root with null. */
export function move(
  doc: Y.Doc,
  nodeId: string,
  parentId: string | null,
  origin: unknown = OPS_ORIGIN,
): void {
  const tree = resolveDocTree(doc);
  const problem = moveProblem(tree, nodeId, parentId);
  if (problem) {
    switch (problem.kind) {
      case 'no-op':
        return;
      case 'not-found':
        throw notFound();
      case 'invalid-parent':
        throw invalidParent();
      case 'would-create-cycle':
        throw new OpError('would-create-cycle', "A folder can't be moved inside itself.");
      case 'duplicate-name':
        throw duplicateNameError(tree, parentId, problem.clash.name, problem.clash);
    }
  }

  doc.transact(() => {
    nodesMap(doc).get(nodeId)?.set('parentId', parentId);
  }, origin);
}

/** Tombstone a visible node. Its content, and everything under it, is kept. */
export function softDelete(
  doc: Y.Doc,
  nodeId: string,
  context: TreeOpContext,
  origin: unknown = OPS_ORIGIN,
): void {
  requireVisible(resolveDocTree(doc), nodeId);
  doc.transact(() => {
    const node = nodesMap(doc).get(nodeId);
    node?.set('deletedAt', context.now ?? Date.now());
    node?.set('deletedBy', context.userId);
    node?.set('deletedByName', context.userName);
  }, origin);
}

/** The node and every tombstoned ancestor along the stored parents, top first. */
function tombstonedChain(byId: ReadonlyMap<string, NodeFields>, nodeId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(nodeId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.deletedAt !== null) chain.push(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return chain.reverse();
}

/**
 * Bring back a hidden node by clearing its tombstone and any tombstoned
 * ancestor that hides it. That also restores whatever was deleted along with
 * those ancestors, which is what undoing a folder delete should do.
 *
 * Restore never refuses because a name has been taken since: a restored node
 * whose name now clashes takes the next free `name (n)`, for real, and is
 * reported in `renamed` so the UI can say so.
 */
export function restore(doc: Y.Doc, nodeId: string, origin: unknown = OPS_ORIGIN): RestoreResult {
  const nodes = readAllNodes(doc);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(nodeId)) throw notFound();
  const chain = tombstonedChain(byId, nodeId);
  if (chain.length === 0) return { restoredIds: [], renamed: [] };

  // Simulate the restore with the restored nodes treated as the newest, so a
  // sibling that took the name meanwhile keeps showing it and only the
  // restored node needs a new one.
  const restoring = new Set(chain);
  const simulated = resolveTree(
    nodes.map((node) =>
      restoring.has(node.id)
        ? {
            ...node,
            deletedAt: null,
            deletedBy: null,
            deletedByName: null,
            createdAt: Number.MAX_SAFE_INTEGER,
          }
        : node,
    ),
  );

  const before = resolveTree(nodes).byId.size;
  if (simulated.byId.size > MAX_LIVE_NODES && simulated.byId.size > before) {
    throw new OpError(
      'too-many-nodes',
      `Restoring this would take the project over its limit of ${String(MAX_LIVE_NODES)} files and folders. Delete something to make room.`,
    );
  }

  const renamed: RestoreResult['renamed'] = [];
  for (const id of chain) {
    const node = simulated.byId.get(id);
    if (!node) continue;
    const name = freeName(simulated, node.parentId, node.name, id);
    if (name !== node.name) renamed.push({ id, from: node.name, to: name });
  }

  doc.transact(() => {
    const map = nodesMap(doc);
    for (const id of chain) {
      map.get(id)?.set('deletedAt', null);
      map.get(id)?.set('deletedBy', null);
      map.get(id)?.set('deletedByName', null);
    }
    for (const change of renamed) map.get(change.id)?.set('name', change.to);
  }, origin);

  return { restoredIds: chain, renamed };
}
