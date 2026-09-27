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
import {
  SCHEMA_VERSION,
  contentsMap,
  isInitialised,
  metaMap,
  nodeNameSchema,
  nodesMap,
  projectMetaSchema,
  type NodeFieldValue,
} from './schema.js';
import { createNodeId } from './ids.js';
import { getTemplate, type TemplateId } from './templates/index.js';
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
  /** The file a new visitor opens. */
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

  for (const file of template.files) {
    const parsedName = nodeNameSchema.safeParse(file.name);
    if (!parsedName.success) {
      throw new OpError('invalid-name', `template file name is invalid: ${file.name}`);
    }
  }

  const fileIds: string[] = [];

  doc.transact(() => {
    const metaY = metaMap(doc);
    metaY.set('schemaVersion', meta.data.schemaVersion);
    metaY.set('name', meta.data.name);
    metaY.set('template', meta.data.template);
    metaY.set('createdAt', meta.data.createdAt);

    const nodes = nodesMap(doc);
    const contents = contentsMap(doc);

    for (const file of template.files) {
      const id = createNodeId();
      const fields: Array<[string, NodeFieldValue]> = [
        ['id', id],
        ['kind', 'file'],
        ['name', file.name],
        ['parentId', null],
        ['createdAt', now],
        ['createdBy', createdBy],
        ['deletedAt', null],
        ['deletedBy', null],
      ];
      nodes.set(id, new Y.Map<NodeFieldValue>(fields));
      contents.set(id, new Y.Text(file.content));
      fileIds.push(id);
    }
  }, OPS_ORIGIN);

  const entryFileId = fileIds[0];
  if (entryFileId === undefined) {
    throw new OpError('invalid-meta', `template ${template.id} has no files`);
  }

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
