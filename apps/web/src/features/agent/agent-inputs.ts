/**
 * What an agent session starts from: the goal with the project's file list
 * for the prompt (capped as the prompt requires, the rest left to list_files),
 * and, for the trace, the template and a fingerprint of the starting files.
 */
import { projectFingerprint, type AgentInputs, type AgentTrace } from '@collabcode/agent';
import { AGENT_INPUT_LIMITS, readFileContent, readMeta, resolveDocTree } from '@collabcode/shared';
import type * as Y from 'yjs';

function projectFiles(doc: Y.Doc): Array<{ path: string; content: string }> {
  return [...resolveDocTree(doc).byId.values()]
    .filter((node) => node.kind === 'file')
    .map((node) => ({ path: node.path, content: readFileContent(doc, node.id) ?? '' }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function agentInputs(doc: Y.Doc, goal: string): AgentInputs {
  const files: string[] = [];
  let chars = 0;
  const paths = projectFiles(doc).map((file) => file.path);
  for (const path of paths) {
    const added = path.length + (files.length === 0 ? 0 : 1);
    if (chars + added > AGENT_INPUT_LIMITS.fileListChars) break;
    files.push(path);
    chars += added;
  }
  return { goal, files, moreFiles: paths.length - files.length };
}

export function startingProject(doc: Y.Doc): AgentTrace['project'] {
  return {
    template: readMeta(doc)?.template ?? null,
    filesFingerprint: projectFingerprint(projectFiles(doc)),
  };
}
