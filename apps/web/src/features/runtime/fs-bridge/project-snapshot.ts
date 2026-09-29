/**
 * What the project should look like on disk: every visible file at its
 * resolved display path, and every visible folder, including empty ones.
 * Deleted nodes are simply absent. Paths are relative to the container's
 * working directory, the way the WebContainer file system API takes them.
 */
import type { ResolvedTree } from '@collabcode/shared';

export type ProjectSnapshot = {
  files: ReadonlyMap<string, string>;
  dirs: ReadonlySet<string>;
};

export function projectSnapshot(
  tree: ResolvedTree,
  contentOf: (fileId: string) => string | undefined,
): ProjectSnapshot {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  for (const node of tree.byId.values()) {
    if (node.kind === 'folder') {
      dirs.add(node.path);
      continue;
    }
    // A file with no content entry is malformed (another client wrote half a
    // node); writing it as empty would be a guess, so it is skipped.
    const content = contentOf(node.id);
    if (content !== undefined) files.set(node.path, content);
  }
  return { files, dirs };
}
