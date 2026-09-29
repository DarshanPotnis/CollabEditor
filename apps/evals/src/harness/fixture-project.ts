/**
 * A task's project: a template, with a fixture folder's files laid over it
 * (apps/evals/fixtures/projects/<name>), as a Y.Doc the agent works on. A
 * reference solution is a folder of apps/evals/fixtures/solutions laid over
 * that in turn. Fixture files are real files, so they read like the projects
 * they are.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFile,
  createFolder,
  initProjectDoc,
  readFileContent,
  replaceText,
  resolveDocTree,
} from '@collabcode/shared';
import * as Y from 'yjs';
import type { ProjectSpec } from '../tasks/task.js';

export const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const SETUP_ORIGIN = 'eval-setup';
const SETUP_ACTOR = { userId: 'eval-setup', userName: 'Eval setup' };

/** Every file under a fixture folder, by its path relative to the folder. */
export async function readFixtureFolder(
  kind: 'projects' | 'solutions',
  name: string,
): Promise<Map<string, string>> {
  const root = join(FIXTURES, kind, name);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(root, path).split(sep).join('/'), await readFile(path, 'utf8'));
  }
  return files;
}

/** The folder a path's file goes in, created with any missing folders above it; null for the root. */
function folderFor(doc: Y.Doc, path: string): string | null {
  const segments = path.split('/').slice(0, -1);
  let parentId: string | null = null;
  let walked = '';
  for (const segment of segments) {
    walked = walked === '' ? segment : `${walked}/${segment}`;
    const existing = resolveDocTree(doc).idByPath.get(walked);
    parentId =
      existing ?? createFolder(doc, { parentId, name: segment }, SETUP_ACTOR, SETUP_ORIGIN);
  }
  return parentId;
}

/** Writes `files` into the document: replacing what is there, creating what is not. */
export function layOver(doc: Y.Doc, files: ReadonlyMap<string, string>): void {
  for (const [path, content] of files) {
    const id = resolveDocTree(doc).idByPath.get(path);
    if (id === undefined) {
      const name = path.split('/').at(-1) ?? path;
      createFile(doc, { parentId: folderFor(doc, path), name, content }, SETUP_ACTOR, SETUP_ORIGIN);
      continue;
    }
    const current = readFileContent(doc, id) ?? '';
    if (current !== content) replaceText(doc, id, current, content, SETUP_ORIGIN);
  }
}

export async function buildProjectDoc(spec: ProjectSpec): Promise<Y.Doc> {
  const doc = new Y.Doc();
  initProjectDoc(doc, { name: 'Eval', template: spec.template });
  if (spec.overlay !== undefined) layOver(doc, await readFixtureFolder('projects', spec.overlay));
  return doc;
}
