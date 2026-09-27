/**
 * The file tree's actions: the one place the UI calls the tree ops. Refusals
 * come back as OpErrors whose messages are shown as-is; where an inline input
 * is waiting (create, rename) the caller shows them, elsewhere a toast does.
 */
import { useMemo } from 'react';
import {
  OpError,
  createFile,
  createFolder,
  purgeDeleted,
  rename,
  restore,
  softDelete,
  type AwarenessUser,
  type NodeKind,
  type TreeOpContext,
} from '@collabcode/shared';
import type { ProjectSession } from '../../collab/useProject.js';
import type { ToastStore } from '../notifications/toast-store.js';
import { runOp, type OpResult } from './run-op.js';

export type TreeActions = {
  create: (kind: NodeKind, parentId: string | null, name: string) => OpResult<string>;
  rename: (id: string, name: string) => OpResult<void>;
  remove: (id: string, name: string, kind: NodeKind) => void;
  restore: (id: string) => void;
  purge: (items: readonly string[] | 'all') => void;
};

export type TreeActionHooks = {
  /** Called with a file's id right after it was created. */
  onCreatedFile: (id: string) => void;
  /** Opens the Recently deleted view. */
  onShowDeleted: () => void;
};

const notReady = (): OpResult<never> => ({
  ok: false,
  error: new OpError('not-found', 'The project is still loading. Try again in a moment.'),
});

export function useTreeActions(
  session: ProjectSession | null,
  identity: AwarenessUser,
  toasts: ToastStore,
  hooks: TreeActionHooks,
): TreeActions {
  const { onCreatedFile, onShowDeleted } = hooks;

  return useMemo((): TreeActions => {
    const context: TreeOpContext = { userId: identity.id, userName: identity.name };

    const showError = (error: OpError): void => {
      toasts.show({
        message: error.message,
        tone: 'error',
        action:
          error.code === 'too-many-nodes-total'
            ? { label: 'Recently deleted', run: onShowDeleted }
            : undefined,
      });
    };

    const restoreWithMessage = (id: string): void => {
      if (!session) return;
      const result = runOp(() => restore(session.doc, id));
      if (!result.ok) {
        showError(result.error);
        return;
      }
      for (const change of result.value.renamed) {
        toasts.show({
          message: `Restored as “${change.to}”, because “${change.from}” is taken now.`,
          tone: 'info',
        });
      }
    };

    return {
      create(kind, parentId, name) {
        if (!session) return notReady();
        const result = runOp(() =>
          kind === 'file'
            ? createFile(session.doc, { parentId, name }, context)
            : createFolder(session.doc, { parentId, name }, context),
        );
        if (!result.ok && result.error.code.startsWith('too-many-nodes')) showError(result.error);
        if (result.ok && kind === 'file') onCreatedFile(result.value);
        return result;
      },

      rename(id, name) {
        if (!session) return notReady();
        return runOp(() => rename(session.doc, id, name));
      },

      remove(id, name, kind) {
        if (!session) return;
        const result = runOp(() => softDelete(session.doc, id, context));
        if (!result.ok) {
          showError(result.error);
          return;
        }
        toasts.show({
          message:
            kind === 'folder' ? `Deleted “${name}” and everything in it.` : `Deleted “${name}”.`,
          tone: 'info',
          action: { label: 'Undo', run: () => restoreWithMessage(id) },
        });
      },

      restore: restoreWithMessage,

      purge(items) {
        if (!session) return;
        const result = runOp(() => purgeDeleted(session.doc, items));
        if (!result.ok) {
          showError(result.error);
          return;
        }
        const count = result.value.purgedIds.length;
        toasts.show({
          message: `Permanently deleted ${String(count)} ${count === 1 ? 'item' : 'items'}.`,
          tone: 'info',
        });
      },
    };
  }, [session, identity.id, identity.name, toasts, onCreatedFile, onShowDeleted]);
}
