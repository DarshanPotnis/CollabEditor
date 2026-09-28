/**
 * The agent's file tools, over a project Y.Doc (docs/PLAN-AI.md §4). The same
 * in the browser, where the doc is the agent's own replica connected to the
 * room, and in the evals, where it is an in-memory doc.
 *
 * What holds here whatever the model asks:
 * - every write goes through packages/shared (text-ops, tree-ops) with the
 *   session's origin, so it respects the limits and "Undo AI changes" can
 *   reverse it; delete is only ever a soft delete;
 * - a file someone else is editing is refused (presence-rule.ts);
 * - a path is only ever looked up among the tree's own nodes.
 */
import {
  OpError,
  createFile,
  createFolder,
  move,
  numberLines,
  readFileContent,
  readNode,
  rename,
  resolveDocTree,
  softDelete,
  type AgentToolInput,
  type AgentUndo,
  type ResolvedNode,
  type ResolvedTree,
  type TreeOpContext,
} from '@collabcode/shared';
import type * as Y from 'yjs';
import { busyFileMessage, someoneElseEditing, type PresenceSource } from '../presence-rule.js';
import type { Typist } from '../typist.js';
import type { HostToolCall, StopSignal, ToolOutcome } from '../types.js';
import { lookupPath, normalizePath, placementOf } from './paths.js';

export const DOC_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search_code',
  'edit_file',
  'create_file',
  'rename_file',
  'delete_file',
] as const;
export type DocToolName = (typeof DOC_TOOL_NAMES)[number];
export type DocToolCall = Extract<HostToolCall, { name: DocToolName }>;

export function isDocToolCall(call: HostToolCall): call is DocToolCall {
  return (DOC_TOOL_NAMES as readonly string[]).includes(call.name);
}

/** read_file shows at most this many lines, or characters, at once. */
export const READ_MAX_LINES = 400;
export const READ_MAX_CHARS = 10_000;
/** search_code lists at most this many matches. */
export const SEARCH_MAX_MATCHES = 50;
const SEARCH_LINE_CHARS = 200;

/** What the agent is doing, for its cursor and status in the room. */
export type DocActivity = {
  tool: DocToolName;
  /** The path it is working on; empty for the whole project. */
  path: string;
  /** The file it is in, or null. */
  fileId: string | null;
  /** Where its cursor goes in that file's text, or null to leave it. */
  cursor: number | null;
};

export type DocToolsContext = {
  doc: Y.Doc;
  /** The session's origin: agentOrigin(sessionId). */
  origin: unknown;
  /** Who the agent is, recorded on what it creates and deletes. */
  actor: { userId: string; userName: string };
  undo: AgentUndo;
  presence: PresenceSource;
  typist: Typist;
  now: () => number;
  onActivity?: (activity: DocActivity) => void;
};

export type DocTools = {
  execute: (call: DocToolCall, signal: StopSignal) => Promise<ToolOutcome>;
};

const ok = (output: string): ToolOutcome => ({ ok: true, output });
const refuse = (output: string): ToolOutcome => ({ ok: false, output });

/** A file's lines, where a final line break does not start another line. */
function linesOf(content: string): string[] {
  const lines = content.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** The 1-based line a character index falls on. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (
    let at = content.indexOf('\n');
    at !== -1 && at < index;
    at = content.indexOf('\n', at + 1)
  ) {
    line += 1;
  }
  return line;
}

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`;
}

/** Visible nodes in the order the tree shows them. */
function inTreeOrder(tree: ResolvedTree): ResolvedNode[] {
  const ordered: ResolvedNode[] = [];
  const visit = (parentId: string | null): void => {
    for (const id of tree.childrenOf.get(parentId) ?? []) {
      const node = tree.byId.get(id);
      if (!node) continue;
      ordered.push(node);
      if (node.kind === 'folder') visit(id);
    }
  };
  visit(null);
  return ordered;
}

/** The files a change to `node` would touch: itself, or everything under a folder. */
function filesUnder(tree: ResolvedTree, node: ResolvedNode): ResolvedNode[] {
  if (node.kind === 'file') return [node];
  const prefix = `${node.path}/`;
  return [...tree.byId.values()].filter(
    (entry) => entry.kind === 'file' && entry.path.startsWith(prefix),
  );
}

export function createDocTools(context: DocToolsContext): DocTools {
  const { doc, origin, undo, presence } = context;
  const report = (activity: DocActivity): void => context.onActivity?.(activity);
  const actor = (): TreeOpContext => ({ ...context.actor, now: context.now() });

  /** The first file under `node` that someone else is editing, if any. */
  const busyFile = (tree: ResolvedTree, node: ResolvedNode): ResolvedNode | undefined =>
    filesUnder(tree, node).find((file) => someoneElseEditing(presence, file.id, context.now()));

  const listFiles = (): ToolOutcome => {
    report({ tool: 'list_files', path: '', fileId: null, cursor: null });
    const lines = inTreeOrder(resolveDocTree(doc)).map((node) =>
      node.kind === 'folder'
        ? `${node.path}/`
        : `${node.path}  ${count(readFileContent(doc, node.id)?.length ?? 0, 'char', 'chars')}`,
    );
    return ok(lines.length === 0 ? 'The project is empty.' : lines.join('\n'));
  };

  const readFile = ({ path, startLine, endLine }: AgentToolInput<'read_file'>): ToolOutcome => {
    const found = lookupPath(resolveDocTree(doc), path);
    if (!found.ok) return refuse(found.message);
    const { node } = found;
    if (node.kind === 'folder') {
      return refuse(`${node.path} is a folder. Call list_files to see what is in it.`);
    }
    const content = readFileContent(doc, node.id) ?? '';
    const lines = linesOf(content);
    const first = startLine ?? 1;
    if (content === '') {
      report({ tool: 'read_file', path: node.path, fileId: node.id, cursor: null });
      return ok(`${node.path} is empty.`);
    }
    if (first > lines.length) {
      return refuse(`${node.path} has ${count(lines.length, 'line', 'lines')}.`);
    }
    const last = Math.min(endLine ?? lines.length, lines.length, first + READ_MAX_LINES - 1);
    const shown: string[] = [];
    let chars = 0;
    for (let line = first; line <= last; line += 1) {
      const text = lines[line - 1] ?? '';
      if (shown.length > 0 && chars + text.length > READ_MAX_CHARS) break;
      shown.push(text);
      chars += text.length + 1;
    }
    const lastShown = first + shown.length - 1;
    report({ tool: 'read_file', path: node.path, fileId: node.id, cursor: null });
    const header = `${node.path}, lines ${String(first)}–${String(lastShown)} of ${String(lines.length)}:`;
    const more =
      lastShown < lines.length && endLine === undefined
        ? `\n…[showing lines ${String(first)}–${String(lastShown)} of ${String(lines.length)}; read on with startLine ${String(lastShown + 1)}]`
        : '';
    return ok(`${header}\n${numberLines(shown.join('\n'), first)}${more}`);
  };

  const searchCode = ({ query }: AgentToolInput<'search_code'>): ToolOutcome => {
    report({ tool: 'search_code', path: '', fileId: null, cursor: null });
    const wanted = query.toLowerCase();
    const matches: string[] = [];
    let total = 0;
    for (const node of inTreeOrder(resolveDocTree(doc))) {
      if (node.kind !== 'file') continue;
      linesOf(readFileContent(doc, node.id) ?? '').forEach((line, index) => {
        if (!line.toLowerCase().includes(wanted)) return;
        total += 1;
        if (matches.length < SEARCH_MAX_MATCHES) {
          matches.push(
            `${node.path}:${String(index + 1)}: ${line.trim().slice(0, SEARCH_LINE_CHARS)}`,
          );
        }
      });
    }
    if (total === 0) return ok(`No matches for "${query}".`);
    const more =
      total > matches.length
        ? `\n…and ${count(total - matches.length, 'more match', 'more matches')}`
        : '';
    return ok(`${matches.join('\n')}${more}`);
  };

  const editFile = async (
    { path, oldText, newText }: AgentToolInput<'edit_file'>,
    signal: StopSignal,
  ): Promise<ToolOutcome> => {
    const tree = resolveDocTree(doc);
    const found = lookupPath(tree, path);
    if (!found.ok) return refuse(found.message);
    const { node } = found;
    if (node.kind === 'folder') return refuse(`${node.path} is a folder, not a file.`);
    if (busyFile(tree, node)) return refuse(busyFileMessage(node.path));
    if (oldText === newText) return ok('No change: the new text is the same as the old.');

    undo.trackEdit(node.id);
    try {
      const change = await context.typist.replace(
        { doc, fileId: node.id, oldText, newText, origin },
        signal,
      );
      const content = readFileContent(doc, node.id) ?? '';
      const from = lineAt(content, change.index);
      const to = from + (change.insert.match(/\n/g)?.length ?? 0);
      report({
        tool: 'edit_file',
        path: node.path,
        fileId: node.id,
        cursor: change.index + change.insert.length,
      });
      return ok(
        from === to
          ? `Edited ${node.path} (changed line ${String(from)}).`
          : `Edited ${node.path} (changed lines ${String(from)}–${String(to)}).`,
      );
    } catch (error) {
      if (error instanceof OpError) return refuse(`${node.path}: ${error.message}`);
      throw error;
    }
  };

  /** The folder at `parentPath`, created (with its parents) if it is missing. */
  const ensureFolder = (
    parentPath: string | null,
  ): { ok: true; id: string | null } | { ok: false; message: string } => {
    if (parentPath === null) return { ok: true, id: null };
    let parentId: string | null = null;
    let walked = '';
    for (const segment of parentPath.split('/')) {
      walked = walked === '' ? segment : `${walked}/${segment}`;
      const tree = resolveDocTree(doc);
      const existing = tree.idByPath.get(walked);
      if (existing !== undefined) {
        if (tree.byId.get(existing)?.kind !== 'folder') {
          return { ok: false, message: `"${walked}" is a file, not a folder.` };
        }
        parentId = existing;
        continue;
      }
      const created: string = createFolder(doc, { parentId, name: segment }, actor(), origin);
      undo.recordTreeAction({ kind: 'created', nodeId: created });
      parentId = created;
    }
    return { ok: true, id: parentId };
  };

  const createNewFile = ({ path, content }: AgentToolInput<'create_file'>): ToolOutcome => {
    const normalized = normalizePath(path);
    if (!normalized.ok) return refuse(normalized.message);
    const target = normalized.path;
    if (resolveDocTree(doc).idByPath.has(target)) {
      return refuse(`"${target}" already exists. Use edit_file to change it.`);
    }
    const { parentPath, name } = placementOf(target);
    try {
      const parent = ensureFolder(parentPath);
      if (!parent.ok) return refuse(parent.message);
      const fileId = createFile(doc, { parentId: parent.id, name, content }, actor(), origin);
      undo.recordTreeAction({ kind: 'created', nodeId: fileId });
      report({ tool: 'create_file', path: target, fileId, cursor: content.length });
      return ok(`Created ${target} (${count(linesOf(content).length, 'line', 'lines')}).`);
    } catch (error) {
      if (error instanceof OpError) return refuse(error.message);
      throw error;
    }
  };

  const renameFile = ({ path, newPath }: AgentToolInput<'rename_file'>): ToolOutcome => {
    const tree = resolveDocTree(doc);
    const found = lookupPath(tree, path);
    if (!found.ok) return refuse(found.message);
    const { node } = found;
    const normalized = normalizePath(newPath);
    if (!normalized.ok) return refuse(normalized.message);
    const target = normalized.path;
    if (target === node.path) return ok(`${node.path} already has that path.`);
    if (tree.idByPath.has(target)) return refuse(`"${target}" already exists.`);
    const busy = busyFile(tree, node);
    if (busy) return refuse(busyFileMessage(busy.path));

    const before = readNode(doc, node.id);
    if (!before) return refuse(`There is no "${node.path}" in the project.`);
    const { parentPath, name } = placementOf(target);
    try {
      const parent = ensureFolder(parentPath);
      if (!parent.ok) return refuse(parent.message);
      if (name !== before.name) rename(doc, node.id, name, origin);
      if (parent.id !== before.parentId) move(doc, node.id, parent.id, origin);
    } catch (error) {
      if (error instanceof OpError) return refuse(error.message);
      throw error;
    } finally {
      const after = readNode(doc, node.id);
      if (after && (after.name !== before.name || after.parentId !== before.parentId)) {
        undo.recordTreeAction({
          kind: 'moved',
          nodeId: node.id,
          from: { parentId: before.parentId, name: before.name },
          to: { parentId: after.parentId, name: after.name },
        });
      }
    }
    const renamed = resolveDocTree(doc).byId.get(node.id);
    report({
      tool: 'rename_file',
      path: renamed?.path ?? target,
      fileId: node.kind === 'file' ? node.id : null,
      cursor: null,
    });
    return ok(`Renamed ${node.path} to ${renamed?.path ?? target}.`);
  };

  const deleteFile = ({ path }: AgentToolInput<'delete_file'>): ToolOutcome => {
    const tree = resolveDocTree(doc);
    const found = lookupPath(tree, path);
    if (!found.ok) return refuse(found.message);
    const { node } = found;
    const busy = busyFile(tree, node);
    if (busy) return refuse(busyFileMessage(busy.path));
    try {
      softDelete(doc, node.id, actor(), origin);
    } catch (error) {
      if (error instanceof OpError) return refuse(error.message);
      throw error;
    }
    undo.recordTreeAction({ kind: 'deleted', nodeId: node.id });
    report({ tool: 'delete_file', path: node.path, fileId: null, cursor: null });
    return ok(`Deleted ${node.path}. People can restore it from Recently deleted.`);
  };

  return {
    async execute(call, signal) {
      switch (call.name) {
        case 'list_files':
          return listFiles();
        case 'read_file':
          return readFile(call.input);
        case 'search_code':
          return searchCode(call.input);
        case 'edit_file':
          return editFile(call.input, signal);
        case 'create_file':
          return createNewFile(call.input);
        case 'rename_file':
          return renameFile(call.input);
        case 'delete_file':
          return deleteFile(call.input);
      }
    },
  };
}
