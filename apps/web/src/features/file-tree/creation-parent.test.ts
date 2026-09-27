import { describe, expect, it } from 'vitest';
import { resolveTree } from '@collabcode/shared';
import { node } from '../../test/nodes.js';
import { creationParent } from './creation-parent.js';

const tree = resolveTree([
  node({ id: 'src', name: 'src', kind: 'folder' }),
  node({ id: 'index', name: 'index.js', parentId: 'src' }),
  node({ id: 'pkg', name: 'package.json' }),
]);

describe('creationParent', () => {
  it('creates inside a selected folder, next to a selected file, else at the root', () => {
    expect(creationParent(tree, 'src')).toBe('src');
    expect(creationParent(tree, 'index')).toBe('src');
    expect(creationParent(tree, 'pkg')).toBeNull();
    expect(creationParent(tree, null)).toBeNull();
    expect(creationParent(tree, 'gone')).toBeNull();
  });
});
