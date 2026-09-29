/**
 * Paths as the model writes them, and the nodes they name. A path is the
 * display path the tree shows (resolve-tree.ts), so the agent sees the same
 * names as the people in the room. Paths never reach a file system from here:
 * each segment is only ever looked up among the tree's own nodes, or checked
 * against the tree rules before anything is created.
 */
import type { ResolvedNode, ResolvedTree } from '@collabcode/shared';

export type PathResult = { ok: true; path: string } | { ok: false; message: string };

/** "./routes//users.js" and "/routes/users.js" both mean "routes/users.js". */
export function normalizePath(raw: string): PathResult {
  const segments = raw
    .normalize('NFC')
    .trim()
    .split(/[/\\]+/)
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) {
    return {
      ok: false,
      message: 'Paths are relative to the project root, and ".." is not allowed.',
    };
  }
  if (segments.length === 0) return { ok: false, message: 'Give a path to a file or folder.' };
  return { ok: true, path: segments.join('/') };
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      const value = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      );
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Up to three paths the model may have meant, closest first. */
export function nearPaths(tree: ResolvedTree, wanted: string): string[] {
  const lower = wanted.toLowerCase();
  const scored: Array<{ path: string; score: number }> = [];
  for (const node of tree.byId.values()) {
    const candidate = node.path.toLowerCase();
    let score: number;
    if (candidate === lower) score = 0;
    else if (baseName(candidate) === baseName(lower)) score = 1;
    else score = 1 + editDistance(candidate, lower, 3);
    if (score <= 4) scored.push({ path: node.path, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || (a.path < b.path ? -1 : 1))
    .slice(0, 3)
    .map((entry) => entry.path);
}

export type Lookup = { ok: true; node: ResolvedNode } | { ok: false; message: string };

/** The visible node at a path, or a message naming what the model may have meant. */
export function lookupPath(tree: ResolvedTree, raw: string): Lookup {
  const normalized = normalizePath(raw);
  if (!normalized.ok) return normalized;
  const id = tree.idByPath.get(normalized.path);
  const node = id === undefined ? undefined : tree.byId.get(id);
  if (node) return { ok: true, node };
  const near = nearPaths(tree, normalized.path);
  const hint =
    near.length === 0
      ? ' Call list_files to see what there is.'
      : ` Did you mean ${near.map((path) => `"${path}"`).join(' or ')}?`;
  return { ok: false, message: `There is no "${normalized.path}" in the project.${hint}` };
}

/** Where a new node would go: its folder (null for the root), and its name. */
export type Placement = { parentPath: string | null; name: string };

export function placementOf(path: string): Placement {
  const slash = path.lastIndexOf('/');
  return slash === -1
    ? { parentPath: null, name: path }
    : { parentPath: path.slice(0, slash), name: path.slice(slash + 1) };
}
