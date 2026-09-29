/**
 * What a session changed in the project, worked out from its trace: the net
 * effect of the file tools that succeeded. A file created and then deleted
 * comes to nothing; one renamed and edited is both. It is what the panel shows
 * when a session ends without the model's own summary (a limit, a failure,
 * Stop), and what an eval can grade.
 *
 * Paths are the ones the model used, normalised the way the file tools do. A
 * folder's contents are followed only as far as the trace names them: deleting
 * a folder lists the folder, not files inside it the session never touched.
 */
import { AGENT_TOOLS } from '@collabcode/shared';
import { normalizePath } from './doc-tools/paths.js';
import type { AgentTrace } from './trace.js';

export type SessionChanges = {
  created: string[];
  edited: string[];
  renamed: Array<{ from: string; to: string }>;
  deleted: string[];
};

/** Where a path the session touched came from: a path it had at the start, or nothing. */
type Tracked = { origin: string | null; edited: boolean };

function pathOf(raw: string): string | null {
  const result = normalizePath(raw);
  return result.ok ? result.path : null;
}

function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

export function sessionChanges(trace: AgentTrace): SessionChanges {
  const files = new Map<string, Tracked>();
  const deleted: string[] = [];
  const take = (path: string): Tracked => {
    const tracked = files.get(path) ?? { origin: path, edited: false };
    files.delete(path);
    return tracked;
  };

  for (const call of trace.steps.flatMap((step) => step.toolCalls)) {
    if (call.isError) continue;
    switch (call.toolName) {
      case 'create_file': {
        const input = AGENT_TOOLS.create_file.input.safeParse(call.input);
        const path = input.success ? pathOf(input.data.path) : null;
        if (path === null) break;
        // Deleted earlier in the session and made again: for the person, it changed.
        const recreated = deleted.indexOf(path);
        if (recreated !== -1) deleted.splice(recreated, 1);
        files.set(path, { origin: recreated === -1 ? null : path, edited: recreated !== -1 });
        break;
      }
      case 'edit_file': {
        const input = AGENT_TOOLS.edit_file.input.safeParse(call.input);
        const path = input.success ? pathOf(input.data.path) : null;
        if (path !== null) files.set(path, { ...take(path), edited: true });
        break;
      }
      case 'rename_file': {
        const input = AGENT_TOOLS.rename_file.input.safeParse(call.input);
        const from = input.success ? pathOf(input.data.path) : null;
        const to = input.success ? pathOf(input.data.newPath) : null;
        if (from === null || to === null) break;
        for (const path of [...files.keys()].filter((known) => isInside(known, from))) {
          if (path !== from) files.set(`${to}${path.slice(from.length)}`, take(path));
        }
        files.set(to, take(from));
        break;
      }
      case 'delete_file': {
        const input = AGENT_TOOLS.delete_file.input.safeParse(call.input);
        const folder = input.success ? pathOf(input.data.path) : null;
        if (folder === null) break;
        const gone = [...files.keys()].filter((known) => isInside(known, folder));
        if (!gone.includes(folder)) gone.push(folder);
        for (const path of gone) {
          const { origin } = take(path);
          if (origin !== null && !deleted.includes(origin)) deleted.push(origin);
        }
        break;
      }
      default:
        break;
    }
  }

  const changes: SessionChanges = { created: [], edited: [], renamed: [], deleted };
  for (const [path, { origin, edited }] of files) {
    if (origin === null) {
      changes.created.push(path);
      continue;
    }
    if (origin !== path) changes.renamed.push({ from: origin, to: path });
    if (edited) changes.edited.push(path);
  }
  return changes;
}
