/**
 * What an agent session starts from: the goal with the project's file list
 * for the prompt (capped as the prompt requires, the rest left to list_files)
 * and, when the whole project is small enough, every file's content, so the
 * agent can act in its first step; that the page cannot run code, when it
 * cannot; and, for the trace, the template and a fingerprint of the starting
 * files. The browser and the evals both start sessions from it, so a model
 * gets the same first message in both.
 */
import { projectFingerprint } from './fingerprint.js';
import type { AgentTrace } from './trace.js';
import type { AgentInputs } from './types.js';
import { AGENT_INPUT_LIMITS, readFileContent, readMeta, resolveDocTree } from '@collabcode/shared';
import type * as Y from 'yjs';

function projectFiles(doc: Y.Doc): Array<{ path: string; content: string }> {
  return [...resolveDocTree(doc).byId.values()]
    .filter((node) => node.kind === 'file')
    .map((node) => ({ path: node.path, content: readFileContent(doc, node.id) ?? '' }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function agentInputs(doc: Y.Doc, goal: string, canRunCode: boolean): AgentInputs {
  const all = projectFiles(doc);
  const files: string[] = [];
  let chars = 0;
  for (const { path } of all) {
    const added = path.length + (files.length === 0 ? 0 : 1);
    if (chars + added > AGENT_INPUT_LIMITS.fileListChars) break;
    files.push(path);
    chars += added;
  }
  const size = all.reduce((total, file) => total + file.content.length, 0);
  const fits = files.length === all.length && size <= AGENT_INPUT_LIMITS.contentsChars;
  return {
    goal,
    files,
    moreFiles: all.length - files.length,
    contents: fits ? all : [],
    ...(!canRunCode && { sandbox: 'unavailable' as const }),
  };
}

export function startingProject(doc: Y.Doc): AgentTrace['project'] {
  return {
    template: readMeta(doc)?.template ?? null,
    filesFingerprint: projectFingerprint(projectFiles(doc)),
  };
}
