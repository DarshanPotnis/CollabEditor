/**
 * Deterministic read-time resolution of the file tree (PLAN.md §6.2, ADR 004).
 *
 * Concurrent tree edits can produce states no single user created: a folder
 * moved into a folder that was concurrently moved into it, two files given
 * the same name by people who had not seen each other's work. Rather than
 * repairing the data (several clients repairing at once would race), every
 * client runs this pure function over the same nodes and draws the same tree.
 *
 * The steps run in this order because each depends on the one before:
 *
 * 1. Parent: a parentId that does not exist, or names a file, means root.
 * 2. Cycles: each node has one parent, so every connected component holds at
 *    most one cycle. Each cycle is broken by moving its smallest
 *    (createdAt, id) member to root. Cycles are disjoint, so the order they
 *    are found in cannot change the result.
 * 3. Deletion cascade, along the parents from steps 1 and 2: a node is hidden
 *    when it or any ancestor has a tombstone.
 * 4. Duplicate names among visible siblings (exact, case-sensitive): in
 *    (createdAt, id) order the first keeps its name, later ones get the next
 *    free `name (n)` that is not any sibling's real name.
 * 5. Paths, depth, and sibling order: folders first, then by name with a
 *    fixed code-point comparison (never the browser's locale, which differs
 *    between machines).
 *
 * Nothing here depends on input order, which the tests check by shuffling.
 */
import { withCopySuffix } from './display-name.js';
import type { NodeFields, NodeKind } from './schema.js';

export type ResolvedNode = {
  id: string;
  kind: NodeKind;
  /** The stored name. */
  name: string;
  /** The name shown, used for paths, Monaco URIs and the WebContainer. */
  displayName: string;
  /** The parent after resolution, which can differ from the stored one. */
  parentId: string | null;
  /** Display names joined by `/`, without a leading slash. */
  path: string;
  /** 0 for children of the root. */
  depth: number;
  createdAt: number;
  createdBy: string;
};

/** Why a node is not in the visible tree, and whose tombstone hid it. */
export type HiddenNode = {
  id: string;
  kind: NodeKind;
  name: string;
  /** The parent after resolution (steps 1 and 2), which may itself be hidden. */
  parentId: string | null;
  /** The nearest node, itself or an ancestor, that has a tombstone. */
  causeId: string;
  deletedAt: number;
  deletedBy: string | null;
  deletedByName: string | null;
};

export type TreeConflictKind = 'duplicate-name' | 'cycle' | 'missing-parent';

export type TreeConflict =
  | { nodeId: string; kind: 'duplicate-name' | 'missing-parent' }
  /** `others` are the rest of the cycle, oldest first, so the UI can name them. */
  | { nodeId: string; kind: 'cycle'; others: readonly string[] };

export type ResolvedTree = {
  /** Visible nodes only. */
  byId: ReadonlyMap<string, ResolvedNode>;
  /** Visible children per folder (null is the root), in display order. */
  childrenOf: ReadonlyMap<string | null, readonly string[]>;
  idByPath: ReadonlyMap<string, string>;
  hidden: ReadonlyMap<string, HiddenNode>;
  /** Only for visible nodes, sorted by node id then kind. */
  conflicts: readonly TreeConflict[];
};

function byAge(a: NodeFields, b: NodeFields): number {
  return a.createdAt - b.createdAt || compareCodePoints(a.id, b.id);
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Folders first, then case-insensitive name, then exact name, then id. */
function displayOrder(a: ResolvedNode, b: ResolvedNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return (
    compareCodePoints(a.displayName.toLowerCase(), b.displayName.toLowerCase()) ||
    compareCodePoints(a.displayName, b.displayName) ||
    compareCodePoints(a.id, b.id)
  );
}

/** Step 1: every node's parent, with missing and non-folder parents at root. */
function initialParents(
  byId: ReadonlyMap<string, NodeFields>,
  conflicts: TreeConflict[],
): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  for (const node of byId.values()) {
    if (node.parentId === null) {
      parents.set(node.id, null);
      continue;
    }
    const parent = byId.get(node.parentId);
    if (parent?.kind === 'folder') {
      parents.set(node.id, parent.id);
    } else {
      parents.set(node.id, null);
      conflicts.push({ nodeId: node.id, kind: 'missing-parent' });
    }
  }
  return parents;
}

/** Step 2: break every cycle at its oldest member. Mutates `parents`. */
function breakCycles(
  byId: ReadonlyMap<string, NodeFields>,
  parents: Map<string, string | null>,
  conflicts: TreeConflict[],
): void {
  const done = new Set<string>();
  for (const start of byId.keys()) {
    const onPath = new Set<string>();
    const path: string[] = [];
    let current: string | null = start;
    while (current !== null && !done.has(current) && !onPath.has(current)) {
      onPath.add(current);
      path.push(current);
      current = parents.get(current) ?? null;
    }

    if (current !== null && onPath.has(current)) {
      const cycle = path.slice(path.indexOf(current)).flatMap((id) => {
        const node = byId.get(id);
        return node ? [node] : [];
      });
      const [oldest, ...others] = cycle.sort(byAge);
      if (oldest) {
        parents.set(oldest.id, null);
        conflicts.push({ nodeId: oldest.id, kind: 'cycle', others: others.map((node) => node.id) });
      }
    }

    for (const id of path) done.add(id);
  }
}

/** Step 3: the tombstoned node (self or nearest ancestor) hiding each node. */
function deletionCauses(
  byId: ReadonlyMap<string, NodeFields>,
  parents: ReadonlyMap<string, string | null>,
): Map<string, string | null> {
  const causes = new Map<string, string | null>();

  for (const start of byId.keys()) {
    const chain: string[] = [];
    let current: string | null = start;
    let cause: string | null = null;

    while (current !== null) {
      const known = causes.get(current);
      if (known !== undefined) {
        cause = known;
        break;
      }
      chain.push(current);
      const node = byId.get(current);
      if (node && node.deletedAt !== null) {
        cause = current;
        break;
      }
      current = parents.get(current) ?? null;
    }

    // Everything walked shares the cause found, except that a tombstoned node
    // is its own cause and the nodes below it inherit that.
    for (const id of chain) causes.set(id, cause);
  }

  return causes;
}

/** Step 4: display names for one folder's visible children. */
function assignDisplayNames(
  siblings: NodeFields[],
  displayNames: Map<string, string>,
  conflicts: TreeConflict[],
): void {
  const taken = new Set(siblings.map((node) => node.name));
  const claimed = new Set<string>();

  for (const node of [...siblings].sort(byAge)) {
    if (!claimed.has(node.name)) {
      claimed.add(node.name);
      displayNames.set(node.id, node.name);
      continue;
    }
    let copy = 2;
    let candidate = withCopySuffix(node.name, copy);
    while (taken.has(candidate)) {
      copy += 1;
      candidate = withCopySuffix(node.name, copy);
    }
    taken.add(candidate);
    displayNames.set(node.id, candidate);
    conflicts.push({ nodeId: node.id, kind: 'duplicate-name' });
  }
}

export function resolveTree(nodes: readonly NodeFields[]): ResolvedTree {
  const byIdRaw = new Map<string, NodeFields>();
  for (const node of nodes) byIdRaw.set(node.id, node);

  const allConflicts: TreeConflict[] = [];
  const parents = initialParents(byIdRaw, allConflicts);
  breakCycles(byIdRaw, parents, allConflicts);
  const causes = deletionCauses(byIdRaw, parents);

  const hidden = new Map<string, HiddenNode>();
  const visibleByParent = new Map<string | null, NodeFields[]>();
  for (const node of byIdRaw.values()) {
    const causeId = causes.get(node.id) ?? null;
    const cause = causeId === null ? undefined : byIdRaw.get(causeId);
    if (cause && cause.deletedAt !== null) {
      hidden.set(node.id, {
        id: node.id,
        kind: node.kind,
        name: node.name,
        parentId: parents.get(node.id) ?? null,
        causeId: cause.id,
        deletedAt: cause.deletedAt,
        deletedBy: cause.deletedBy,
        deletedByName: cause.deletedByName,
      });
      continue;
    }
    const parentId = parents.get(node.id) ?? null;
    const siblings = visibleByParent.get(parentId) ?? [];
    siblings.push(node);
    visibleByParent.set(parentId, siblings);
  }

  const displayNames = new Map<string, string>();
  for (const siblings of visibleByParent.values()) {
    assignDisplayNames(siblings, displayNames, allConflicts);
  }

  // Step 5: walk down from the root so every visible node gets a path.
  const byId = new Map<string, ResolvedNode>();
  const childrenOf = new Map<string | null, string[]>();
  const idByPath = new Map<string, string>();
  const queue: Array<{ parentId: string | null; prefix: string; depth: number }> = [
    { parentId: null, prefix: '', depth: 0 },
  ];

  for (let index = 0; index < queue.length; index += 1) {
    const next = queue[index];
    if (!next) continue;
    const children = (visibleByParent.get(next.parentId) ?? []).map((node): ResolvedNode => {
      const displayName = displayNames.get(node.id) ?? node.name;
      return {
        id: node.id,
        kind: node.kind,
        name: node.name,
        displayName,
        parentId: next.parentId,
        path: next.prefix + displayName,
        depth: next.depth,
        createdAt: node.createdAt,
        createdBy: node.createdBy,
      };
    });
    children.sort(displayOrder);
    childrenOf.set(
      next.parentId,
      children.map((child) => child.id),
    );

    for (const child of children) {
      byId.set(child.id, child);
      idByPath.set(child.path, child.id);
      if (child.kind === 'folder') {
        queue.push({ parentId: child.id, prefix: `${child.path}/`, depth: child.depth + 1 });
      }
    }
  }

  const conflicts = allConflicts
    .filter((conflict) => byId.has(conflict.nodeId))
    .sort((a, b) => compareCodePoints(a.nodeId, b.nodeId) || compareCodePoints(a.kind, b.kind));

  return { byId, childrenOf, idByPath, hidden, conflicts };
}
