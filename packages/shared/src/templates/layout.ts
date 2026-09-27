/**
 * Turning a template's file paths into the folders and files to create, in an
 * order where every parent comes before its children.
 */
import { OpError } from '../op-error.js';
import { nodeNameSchema, type NodeKind } from '../schema.js';
import { nameKey } from '../tree-rules.js';
import type { TemplateFile } from './types.js';

export type TemplateEntry = {
  path: string;
  /** null for the project root. */
  parentPath: string | null;
  name: string;
  kind: NodeKind;
  /** Only for files. */
  content?: string;
};

/**
 * Throws OpError('invalid-name') for a segment that is not a valid node name,
 * or for two paths that would clash under the write-time rules (including a
 * file that is also used as a folder).
 */
export function layoutTemplate(files: readonly TemplateFile[]): TemplateEntry[] {
  const entries: TemplateEntry[] = [];
  const byKey = new Map<string, NodeKind>();

  const add = (entry: TemplateEntry): void => {
    const key = nameKey(entry.path);
    const existing = byKey.get(key);
    if (existing === 'folder' && entry.kind === 'folder') return;
    if (existing !== undefined) {
      throw new OpError('invalid-name', `template path clashes with another: ${entry.path}`);
    }
    byKey.set(key, entry.kind);
    entries.push(entry);
  };

  for (const file of files) {
    const segments = file.path.split('/');
    for (const segment of segments) {
      if (!nodeNameSchema.safeParse(segment).success) {
        throw new OpError('invalid-name', `template path is invalid: ${file.path}`);
      }
    }
    segments.forEach((name, index) => {
      const path = segments.slice(0, index + 1).join('/');
      const parentPath = index === 0 ? null : segments.slice(0, index).join('/');
      const isFile = index === segments.length - 1;
      add(
        isFile
          ? { path, parentPath, name, kind: 'file', content: file.content }
          : { path, parentPath, name, kind: 'folder' },
      );
    });
  }

  return entries;
}
