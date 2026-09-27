import { contentsMap, resolveTree } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { node } from '../../test/nodes.js';
import { projectFiles } from './project-files.js';

describe('projectFiles', () => {
  const tree = resolveTree([
    node({ id: 'routes', name: 'routes', kind: 'folder' }),
    node({ id: 'users', name: 'users.js', parentId: 'routes' }),
    node({ id: 'gone', name: 'old.js', deletedAt: 5 }),
  ]);
  const doc = new Y.Doc();
  contentsMap(doc).set('users', new Y.Text('export {};'));

  it('lists visible files by path, not folders or deleted files', () => {
    expect([...projectFiles(tree, doc).paths]).toEqual(['routes/users.js']);
  });

  it('reads a file by its path, and nothing for anything else', () => {
    const files = projectFiles(tree, doc);
    expect(files.read('routes/users.js')).toBe('export {};');
    expect(files.read('routes')).toBeNull();
    expect(files.read('old.js')).toBeNull();
  });
});
