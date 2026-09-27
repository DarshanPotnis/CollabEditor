/**
 * Turning validated node fields into Y types. Callers validate first and run
 * this inside their own `doc.transact()`; it performs no checks of its own.
 */
import * as Y from 'yjs';
import { contentsMap, nodesMap, type NodeFieldValue, type NodeFields } from './schema.js';

export function insertNode(doc: Y.Doc, fields: NodeFields, content?: string): void {
  const entries: Array<[keyof NodeFields, NodeFieldValue]> = [
    ['id', fields.id],
    ['kind', fields.kind],
    ['name', fields.name],
    ['parentId', fields.parentId],
    ['createdAt', fields.createdAt],
    ['createdBy', fields.createdBy],
    ['deletedAt', fields.deletedAt],
    ['deletedBy', fields.deletedBy],
    ['deletedByName', fields.deletedByName],
  ];
  nodesMap(doc).set(fields.id, new Y.Map<NodeFieldValue>(entries));
  if (fields.kind === 'file') contentsMap(doc).set(fields.id, new Y.Text(content ?? ''));
}
