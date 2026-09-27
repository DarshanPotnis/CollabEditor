/**
 * Explaining a resolved cycle. When two people move folders into each other
 * at the same moment, resolveTree breaks the cycle identically for both, but
 * one of them sees their move "turned around". Both get a short explanation
 * when the cycle first appears.
 */
import type { ResolvedTree, TreeConflict } from '@collabcode/shared';

type CycleConflict = Extract<TreeConflict, { kind: 'cycle' }>;

/**
 * Cycles in `next` that were not in `prev`. Nothing counts as new against an
 * empty tree, so a cycle already stored in the project does not announce
 * itself on every page load.
 */
export function newCycles(prev: ResolvedTree, next: ResolvedTree): CycleConflict[] {
  if (prev.byId.size === 0) return [];
  const known = new Set(
    prev.conflicts
      .filter((conflict) => conflict.kind === 'cycle')
      .map((conflict) => conflict.nodeId),
  );
  return next.conflicts.filter(
    (conflict): conflict is CycleConflict =>
      conflict.kind === 'cycle' && !known.has(conflict.nodeId),
  );
}

function quoted(tree: ResolvedTree, id: string): string {
  return `“${tree.byId.get(id)?.displayName ?? 'a folder'}”`;
}

export function cycleMessage(tree: ResolvedTree, conflict: CycleConflict): string {
  const moved = quoted(tree, conflict.nodeId);
  const others = conflict.others.map((id) => quoted(tree, id));
  const who =
    others.length === 0
      ? `${moved} was moved into itself`
      : `${[moved, ...others].join(' and ')} were moved into each other at the same time`;
  return `${who}, so ${moved} was kept at the top level. Nothing was lost.`;
}
