/**
 * The single write path into a project Y.Doc.
 *
 * Every mutation runs inside `doc.transact()` with an origin tag so the client
 * can tell its own writes apart from remote ones. UI components never touch Y
 * types directly.
 *
 * Exception, documented in CLAUDE.md: y-monaco writes editor keystrokes
 * straight into the file's Y.Text. That is the one bypass, and it is why the
 * per-file size limit is enforced at the editor rather than here.
 *
 * This module creates a project's document. The tree ops (createFile,
 * createFolder, rename, move, softDelete, restore) live in tree-ops.ts.
 */
import * as Y from 'yjs';
import { SCHEMA_VERSION, isInitialised, metaMap, projectMetaSchema } from './schema.js';
import { createNodeId } from './ids.js';
import { insertNode } from './node-writer.js';
import { getTemplate, type TemplateId } from './templates/index.js';
import { layoutTemplate } from './templates/layout.js';
import { OPS_ORIGIN, OpError } from './op-error.js';

export { OPS_ORIGIN, OpError, type OpErrorCode } from './op-error.js';

export type InitProjectDocInput = {
  name: string;
  template: TemplateId;
  /** Awareness user id, or 'system' for server-side creation. */
  createdBy?: string;
  /** Injectable clock so tests are deterministic. */
  now?: number;
};

export type InitProjectDocResult = {
  /** The file a new visitor opens: the template's entry path. */
  entryFileId: string;
  fileIds: string[];
};

/**
 * Build a project's initial document from a template. Called once, on the
 * server, before the document is ever handed to a client.
 */
export function initProjectDoc(doc: Y.Doc, input: InitProjectDocInput): InitProjectDocResult {
  if (isInitialised(doc)) {
    throw new OpError('already-initialised', 'this document already has project metadata');
  }

  const template = getTemplate(input.template);
  const createdBy = input.createdBy ?? 'system';
  const now = input.now ?? Date.now();

  const meta = projectMetaSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    name: input.name,
    template: template.id,
    createdAt: now,
  });
  if (!meta.success) {
    throw new OpError('invalid-meta', meta.error.issues.map((issue) => issue.message).join('; '));
  }

  const entries = layoutTemplate(template.files).map((entry) => ({ ...entry, id: createNodeId() }));
  const idByPath = new Map(entries.map((entry) => [entry.path, entry.id]));
  const entryFileId = idByPath.get(template.entryPath);
  if (entryFileId === undefined) {
    throw new OpError('invalid-meta', `template ${template.id} has no ${template.entryPath}`);
  }

  doc.transact(() => {
    const metaY = metaMap(doc);
    metaY.set('schemaVersion', meta.data.schemaVersion);
    metaY.set('name', meta.data.name);
    metaY.set('template', meta.data.template);
    metaY.set('createdAt', meta.data.createdAt);

    for (const entry of entries) {
      const parentId = entry.parentPath === null ? null : (idByPath.get(entry.parentPath) ?? null);
      insertNode(
        doc,
        {
          id: entry.id,
          kind: entry.kind,
          name: entry.name,
          parentId,
          createdAt: now,
          createdBy,
          deletedAt: null,
          deletedBy: null,
          deletedByName: null,
        },
        entry.content,
      );
    }
  }, OPS_ORIGIN);

  const fileIds = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.id);

  return { entryFileId, fileIds };
}

/**
 * Encode a fresh project document as a Yjs update, ready to be stored.
 * The caller owns the Y.Doc's lifetime.
 */
export function createProjectUpdate(input: InitProjectDocInput): {
  update: Uint8Array;
  entryFileId: string;
} {
  const doc = new Y.Doc();
  try {
    const { entryFileId } = initProjectDoc(doc, input);
    return { update: Y.encodeStateAsUpdate(doc), entryFileId };
  } finally {
    doc.destroy();
  }
}
