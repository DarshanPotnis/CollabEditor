/**
 * The project as files on disk, which the sandbox container mounts: written
 * from the agent's document before anything runs, as the browser's fs-bridge
 * writes the person's document into the WebContainer.
 *
 * Only files that came from the document are ever changed or removed here, so
 * files a program in the sandbox wrote itself stay, as in the WebContainer.
 * Paths come from the document's own tree; each is checked to land inside the
 * directory all the same.
 *
 * The directories live under apps/evals/.work (git-ignored), not the system's
 * temp folder: a Docker VM on a Mac (Colima) cannot write to the latter.
 */
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileContent, resolveDocTree } from '@collabcode/shared';
import type * as Y from 'yjs';

export const WORK_ROOT = fileURLToPath(new URL('../../.work/', import.meta.url));

/** Every live file in the document, by path. */
export function documentFiles(doc: Y.Doc): Map<string, string> {
  const files = new Map<string, string>();
  for (const node of resolveDocTree(doc).byId.values()) {
    if (node.kind === 'file') files.set(node.path, readFileContent(doc, node.id) ?? '');
  }
  return files;
}

export class ProjectDir {
  private readonly written = new Map<string, string>();

  private constructor(readonly path: string) {}

  /** A fresh, empty directory for one session of one run. */
  static async create(runId: string, session: string): Promise<ProjectDir> {
    const path = resolve(WORK_ROOT, runId, session, 'project');
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true });
    return new ProjectDir(path);
  }

  private inside(relative: string): string {
    const target = resolve(this.path, relative);
    if (!target.startsWith(`${this.path}${sep}`)) {
      throw new Error(`Refusing to write outside the project directory: ${relative}`);
    }
    return target;
  }

  /** Writes what changed since the last sync; true when anything did. */
  async sync(files: ReadonlyMap<string, string>): Promise<boolean> {
    let changed = false;
    for (const [path, content] of files) {
      if (this.written.get(path) === content) continue;
      const target = this.inside(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      this.written.set(path, content);
      changed = true;
    }
    for (const path of [...this.written.keys()]) {
      if (files.has(path)) continue;
      await unlink(this.inside(path)).catch((error: unknown) => {
        // Already gone (a program in the sandbox removed it) is what we wanted.
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
      this.written.delete(path);
      changed = true;
    }
    return changed;
  }
}
