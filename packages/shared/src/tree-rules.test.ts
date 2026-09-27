import { describe, expect, it } from 'vitest';
import { resolveTree } from './resolve-tree.js';
import type { NodeFields } from './schema.js';
import { findNameClash, freeName, isSameOrInside, moveProblem, nameKey } from './tree-rules.js';

function node(overrides: Partial<NodeFields> & Pick<NodeFields, 'id' | 'name'>): NodeFields {
  return {
    kind: 'file',
    parentId: null,
    createdAt: 100,
    createdBy: 'user',
    deletedAt: null,
    deletedBy: null,
    deletedByName: null,
    ...overrides,
  };
}

const tree = resolveTree([
  node({ id: 'src', name: 'src', kind: 'folder' }),
  node({ id: 'lib', name: 'lib', kind: 'folder', parentId: 'src' }),
  node({ id: 'deep', name: 'deep', kind: 'folder', parentId: 'lib' }),
  node({ id: 'index', name: 'index.js', parentId: 'src' }),
  node({ id: 'u1', name: 'utils.js', createdAt: 1 }),
  node({ id: 'u2', name: 'utils.js', createdAt: 2 }),
  node({ id: 'gone', name: 'gone.js', deletedAt: 5 }),
]);

describe('nameKey', () => {
  it('folds case without the locale', () => {
    expect(nameKey('Index.JS')).toBe('index.js');
    expect(nameKey('İ.js')).toBe('i̇.js');
  });
});

describe('findNameClash', () => {
  it('finds an exact match', () => {
    expect(findNameClash(tree, 'src', 'index.js')?.id).toBe('index');
  });

  it('finds a match that differs only in case', () => {
    expect(findNameClash(tree, 'src', 'Index.js')?.id).toBe('index');
    expect(findNameClash(tree, null, 'SRC')?.id).toBe('src');
  });

  it('matches display names too', () => {
    expect(findNameClash(tree, null, 'utils (2).js')?.id).toBe('u2');
  });

  it('ignores the node being renamed', () => {
    expect(findNameClash(tree, 'src', 'INDEX.js', 'index')).toBeNull();
  });

  it('ignores hidden nodes and other folders', () => {
    expect(findNameClash(tree, null, 'gone.js')).toBeNull();
    expect(findNameClash(tree, null, 'index.js')).toBeNull();
  });
});

describe('freeName', () => {
  it('returns the name when it is free', () => {
    expect(freeName(tree, 'src', 'new.js')).toBe('new.js');
  });

  it('skips taken suffixes, including display names', () => {
    expect(freeName(tree, null, 'utils.js')).toBe('utils (3).js');
    expect(freeName(tree, 'src', 'Index.js')).toBe('Index (2).js');
  });
});

describe('isSameOrInside', () => {
  it('is true for the node itself and its descendants', () => {
    expect(isSameOrInside(tree, 'src', 'src')).toBe(true);
    expect(isSameOrInside(tree, 'src', 'deep')).toBe(true);
    expect(isSameOrInside(tree, 'lib', 'src')).toBe(false);
  });
});

describe('moveProblem', () => {
  it('allows a valid move', () => {
    expect(moveProblem(tree, 'index', 'lib')).toBeNull();
    expect(moveProblem(tree, 'lib', null)).toBeNull();
  });

  it('refuses moving a folder into itself or below itself', () => {
    expect(moveProblem(tree, 'src', 'src')).toEqual({ kind: 'would-create-cycle' });
    expect(moveProblem(tree, 'src', 'deep')).toEqual({ kind: 'would-create-cycle' });
  });

  it('refuses a clash in the target folder', () => {
    expect(moveProblem(tree, 'u1', 'src')).toBeNull();
    const problem = moveProblem(
      resolveTree([
        node({ id: 'a', name: 'a.js' }),
        node({ id: 'dir', name: 'dir', kind: 'folder' }),
        node({ id: 'b', name: 'A.js', parentId: 'dir' }),
      ]),
      'a',
      'dir',
    );
    expect(problem).toMatchObject({ kind: 'duplicate-name', clash: { id: 'b' } });
  });

  it('reports a move to the current parent as a no-op', () => {
    expect(moveProblem(tree, 'index', 'src')).toEqual({ kind: 'no-op' });
  });

  it('refuses a missing node, a file target and a hidden target', () => {
    expect(moveProblem(tree, 'gone', null)).toEqual({ kind: 'not-found' });
    expect(moveProblem(tree, 'lib', 'index')).toEqual({ kind: 'invalid-parent' });
    expect(moveProblem(tree, 'lib', 'nope')).toEqual({ kind: 'invalid-parent' });
  });
});
