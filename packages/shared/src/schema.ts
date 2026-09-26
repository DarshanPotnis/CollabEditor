/**
 * The shape of a project Y.Doc (schema v1) and typed access to it.
 *
 * Phase 1 only ever creates one file, but it uses the full node/content schema
 * so Phase 2 can add a file tree without migrating existing documents.
 */
import type * as Y from 'yjs';
import { z } from 'zod';
import { MAX_NAME_LENGTH, MAX_PROJECT_NAME_LENGTH } from './limits.js';

export const SCHEMA_VERSION = 1;

/** Top-level keys of a project document. */
export const DOC_KEY = {
  meta: 'meta',
  nodes: 'nodes',
  contents: 'contents',
} as const;

export const nodeKindSchema = z.enum(['file', 'folder']);
export type NodeKind = z.infer<typeof nodeKindSchema>;

/**
 * A node name is a label, never an identity. It has to survive being turned
 * into a path segment, a Monaco URI and (in Phase 3) a real file name.
 */
export const nodeNameSchema = z
  .string()
  .min(1)
  .max(MAX_NAME_LENGTH)
  .refine((name) => name.trim() === name, { message: 'name has leading or trailing whitespace' })
  .refine((name) => !/[/\\]/.test(name), { message: 'name may not contain a slash' })
  .refine((name) => name !== '.' && name !== '..', { message: 'name is reserved' })
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), {
    message: 'name may not contain control characters',
  });

export const nodeFieldsSchema = z.object({
  id: z.string().min(1),
  kind: nodeKindSchema,
  name: nodeNameSchema,
  parentId: z.string().min(1).nullable(),
  createdAt: z.number().int().nonnegative(),
  createdBy: z.string().min(1),
  deletedAt: z.number().int().nonnegative().nullable(),
});
export type NodeFields = z.infer<typeof nodeFieldsSchema>;

/** Every value stored in a node Y.Map. */
export type NodeFieldValue = string | number | null;

export const projectMetaSchema = z.object({
  schemaVersion: z.number().int().positive(),
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  template: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type ProjectMeta = z.infer<typeof projectMetaSchema>;

export type MetaValue = string | number;

export function metaMap(doc: Y.Doc): Y.Map<MetaValue> {
  return doc.getMap<MetaValue>(DOC_KEY.meta);
}

export function nodesMap(doc: Y.Doc): Y.Map<Y.Map<NodeFieldValue>> {
  return doc.getMap<Y.Map<NodeFieldValue>>(DOC_KEY.nodes);
}

export function contentsMap(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>(DOC_KEY.contents);
}

/**
 * Read project metadata. Returns null when the document has not been
 * initialised, or when another client wrote something that does not match the
 * schema. Callers decide what to do about it; this never throws.
 */
export function readMeta(doc: Y.Doc): ProjectMeta | null {
  const parsed = projectMetaSchema.safeParse(metaMap(doc).toJSON());
  return parsed.success ? parsed.data : null;
}

/** Read one node, or null when it is missing or malformed. */
export function readNode(doc: Y.Doc, nodeId: string): NodeFields | null {
  const node = nodesMap(doc).get(nodeId);
  if (!node) return null;
  const parsed = nodeFieldsSchema.safeParse(node.toJSON());
  return parsed.success ? parsed.data : null;
}

/** Every live (non-tombstoned) node that parses, in insertion order. */
export function readNodes(doc: Y.Doc): NodeFields[] {
  const nodes: NodeFields[] = [];
  for (const raw of nodesMap(doc).values()) {
    const parsed = nodeFieldsSchema.safeParse(raw.toJSON());
    if (parsed.success && parsed.data.deletedAt === null) nodes.push(parsed.data);
  }
  return nodes;
}

/** The Y.Text holding a file's content, or undefined when there is none. */
export function readFileText(doc: Y.Doc, fileId: string): Y.Text | undefined {
  return contentsMap(doc).get(fileId);
}

/** A file's content as a plain string, or undefined when there is none. */
export function readFileContent(doc: Y.Doc, fileId: string): string | undefined {
  return contentsMap(doc).get(fileId)?.toJSON();
}

/** True once the document has been initialised from a template. */
export function isInitialised(doc: Y.Doc): boolean {
  return metaMap(doc).has('schemaVersion');
}
