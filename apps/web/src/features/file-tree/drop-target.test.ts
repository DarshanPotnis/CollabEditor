import { describe, expect, it } from 'vitest';
import { resolveTree } from '@collabcode/shared';
import { node } from '../../test/nodes.js';
import { canMoveInto, dropParent } from './drop-target.js';

const tree = resolveTree([
  node({ id: 'src', name: 'src', kind: 'folder' }),
  node({ id: 'lib', name: 'lib', kind: 'folder', parentId: 'src' }),
  node({ id: 'index', name: 'index.js', parentId: 'src' }),
  node({ id: 'pkg', name: 'package.json' }),
  node({ id: 'other', name: 'index.js', parentId: 'lib' }),
]);

describe('dropParent', () => {
  it('drops into a folder, beside a file, or at the root', () => {
    expect(dropParent(tree, 'lib')).toBe('lib');
    expect(dropParent(tree, 'index')).toBe('src');
    expect(dropParent(tree, 'pkg')).toBeNull();
    expect(dropParent(tree, null)).toBeNull();
  });
});

describe('canMoveInto', () => {
  it('allows a real move and refuses no-ops, cycles and clashes', () => {
    expect(canMoveInto(tree, 'pkg', 'lib')).toBe(true);
    expect(canMoveInto(tree, 'lib', null)).toBe(true);
    expect(canMoveInto(tree, 'index', 'src')).toBe(false);
    expect(canMoveInto(tree, 'src', 'lib')).toBe(false);
    expect(canMoveInto(tree, 'index', 'lib')).toBe(false);
  });
});
