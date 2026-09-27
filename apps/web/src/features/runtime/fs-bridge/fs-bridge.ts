/**
 * Keeps a running container's files in step with the Y.Doc, one way only
 * (PLAN.md §10.2, ADR 005). Nothing the container produces (node_modules,
 * lockfiles, logs, build output) is ever read back into the document.
 *
 * On every change to the tree or to any file's content, the scheduler waits
 * for a quiet moment, then the bridge compares the whole project with what it
 * last wrote and applies the difference (fs-plan.ts). A failed operation is
 * reported and left out of `applied`, so the next sync retries it.
 */
import type * as Y from 'yjs';
import { contentsMap, nodesMap, readFileContent, resolveDocTree } from '@collabcode/shared';
import type { ContainerFs } from './container-fs.js';
import { planSync, type FsOp } from './fs-plan.js';
import { projectSnapshot } from './project-snapshot.js';
import { createSyncScheduler } from './sync-scheduler.js';

export type SyncResult = { written: string[]; removed: string[] };

export type FsBridgeOptions = {
  doc: Y.Doc;
  fs: ContainerFs;
  /** An operation or a whole sync failed. `path` is null for the latter. */
  onError: (path: string | null, error: unknown) => void;
  /** Called after a sync that changed at least one file. */
  onSynced: (result: SyncResult) => void;
  quietMs?: number;
  maxWaitMs?: number;
};

export type FsBridge = {
  /** Write the whole project, then keep it in step. */
  start: () => Promise<void>;
  /** Apply any pending change now. */
  flush: () => Promise<void>;
  stop: () => void;
};

export const SYNC_QUIET_MS = 250;
export const SYNC_MAX_WAIT_MS = 1_000;

export function createFsBridge(options: FsBridgeOptions): FsBridge {
  const { doc, fs } = options;
  const applied = { files: new Map<string, string>(), dirs: new Set<string>() };
  let stopped = false;

  const apply = async (op: FsOp, result: SyncResult): Promise<void> => {
    switch (op.kind) {
      case 'rm':
        await fs.rm(op.path, { force: true });
        applied.files.delete(op.path);
        result.removed.push(op.path);
        return;
      case 'rmdir-if-empty': {
        // Not ours any more either way: if something else put files in it
        // (npm, the program), it stays, and so do they. A folder that cannot
        // be listed is already gone, which is the outcome we wanted.
        applied.dirs.delete(op.path);
        const entries = await fs.readdir(op.path).catch((): string[] | null => null);
        if (entries !== null && entries.length === 0) {
          await fs.rm(op.path, { recursive: true, force: true });
        }
        return;
      }
      case 'mkdir':
        await fs.mkdir(op.path, { recursive: true });
        applied.dirs.add(op.path);
        return;
      case 'write':
        await fs.writeFile(op.path, op.content);
        applied.files.set(op.path, op.content);
        result.written.push(op.path);
        return;
    }
  };

  const sync = async (): Promise<void> => {
    const desired = projectSnapshot(resolveDocTree(doc), (id) => readFileContent(doc, id));
    const result: SyncResult = { written: [], removed: [] };
    for (const op of planSync(applied, desired)) {
      if (stopped) return;
      try {
        await apply(op, result);
      } catch (error) {
        options.onError(op.path, error);
      }
    }
    if (result.written.length > 0 || result.removed.length > 0) options.onSynced(result);
  };

  const scheduler = createSyncScheduler(sync, {
    quietMs: options.quietMs ?? SYNC_QUIET_MS,
    maxWaitMs: options.maxWaitMs ?? SYNC_MAX_WAIT_MS,
    onError: (error) => options.onError(null, error),
  });
  const onChange = (): void => scheduler.request();

  return {
    async start() {
      nodesMap(doc).observeDeep(onChange);
      contentsMap(doc).observeDeep(onChange);
      await scheduler.flush();
    },
    flush: () => scheduler.flush(),
    stop() {
      stopped = true;
      scheduler.dispose();
      nodesMap(doc).unobserveDeep(onChange);
      contentsMap(doc).unobserveDeep(onChange);
    },
  };
}
