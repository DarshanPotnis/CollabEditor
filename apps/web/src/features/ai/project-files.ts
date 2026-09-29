/**
 * The project's visible files by path, with their text read from the shared
 * document only when asked, for prompts that need code the person did not
 * select (Explain with AI on a crash).
 */
import { readFileContent, type ResolvedTree } from '@collabcode/shared';
import type * as Y from 'yjs';
import type { ProjectFiles } from './prompts/error-prompt.js';

export function projectFiles(tree: ResolvedTree, doc: Y.Doc): ProjectFiles {
  const idByPath = new Map<string, string>();
  for (const node of tree.byId.values()) {
    if (node.kind === 'file') idByPath.set(node.path, node.id);
  }
  return {
    paths: new Set(idByPath.keys()),
    read: (path) => {
      const id = idByPath.get(path);
      return id === undefined ? null : (readFileContent(doc, id) ?? null);
    },
  };
}
