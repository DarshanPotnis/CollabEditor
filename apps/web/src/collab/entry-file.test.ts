import { describe, expect, it } from 'vitest';
import { resolveTree, type ProjectMeta } from '@collabcode/shared';
import { node } from '../test/nodes.js';
import { entryFileId } from './entry-file.js';

const meta: ProjectMeta = { schemaVersion: 1, name: 'T', template: 'express-api', createdAt: 1 };

describe('entryFileId', () => {
  it("opens the template's entry path", () => {
    const tree = resolveTree([
      node({ id: 'pkg', name: 'package.json' }),
      node({ id: 'entry', name: 'index.js' }),
    ]);
    expect(entryFileId(tree, meta)).toBe('entry');
  });

  it('falls back to the first file, depth first, when the entry is gone', () => {
    const tree = resolveTree([
      node({ id: 'dir', name: 'a', kind: 'folder' }),
      node({ id: 'nested', name: 'n.js', parentId: 'dir' }),
      node({ id: 'entry', name: 'index.js', deletedAt: 5 }),
    ]);
    expect(entryFileId(tree, meta)).toBe('nested');
  });

  it('ignores a folder at the entry path, and returns null for an empty project', () => {
    expect(
      entryFileId(resolveTree([node({ id: 'f', name: 'index.js', kind: 'folder' })]), meta),
    ).toBeNull();
    expect(entryFileId(resolveTree([]), null)).toBeNull();
  });
});
