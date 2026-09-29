/**
 * The file operations that turn what the bridge last wrote into what the
 * project should be now (PLAN.md §10.2, ADR 005).
 *
 * The safety rule: **the bridge only removes what it wrote itself.** A file is
 * removed only if it is in `applied.files`, and a folder only if the bridge
 * created it and it is empty. So `node_modules`, lockfiles, build output and
 * logs that npm or the program create are never touched, even when a folder
 * they sit in is deleted from the project.
 *
 * A rename is a remove plus a write. Order: remove stale files, then folders
 * (deepest first, only if empty), then create folders (shallowest first),
 * then write new and changed files, so a path can change between file and
 * folder in one sync.
 */
import type { ProjectSnapshot } from './project-snapshot.js';

export type FsOp =
  | { kind: 'rm'; path: string }
  | { kind: 'rmdir-if-empty'; path: string }
  | { kind: 'mkdir'; path: string }
  | { kind: 'write'; path: string; content: string };

export const NOTHING_APPLIED: ProjectSnapshot = { files: new Map(), dirs: new Set() };

const depth = (path: string): number => path.split('/').length;

export function planSync(applied: ProjectSnapshot, desired: ProjectSnapshot): FsOp[] {
  const ops: FsOp[] = [];

  for (const path of [...applied.files.keys()].sort()) {
    if (!desired.files.has(path)) ops.push({ kind: 'rm', path });
  }

  const staleDirs = [...applied.dirs].filter((path) => !desired.dirs.has(path));
  staleDirs.sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : 1));
  for (const path of staleDirs) ops.push({ kind: 'rmdir-if-empty', path });

  const newDirs = [...desired.dirs].filter((path) => !applied.dirs.has(path));
  newDirs.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1));
  for (const path of newDirs) ops.push({ kind: 'mkdir', path });

  for (const [path, content] of [...desired.files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (applied.files.get(path) !== content) ops.push({ kind: 'write', path, content });
  }

  return ops;
}
