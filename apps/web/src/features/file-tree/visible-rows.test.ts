import { describe, expect, it } from 'vitest';
import { resolveTree } from '@collabcode/shared';
import { node } from '../../test/nodes.js';
import { ancestorIds, draftInsertIndex, visibleRows } from './visible-rows.js';

const tree = resolveTree([
  node({ id: 'src', name: 'src', kind: 'folder' }),
  node({ id: 'lib', name: 'lib', kind: 'folder', parentId: 'src' }),
  node({ id: 'empty', name: 'empty', kind: 'folder' }),
  node({ id: 'deep', name: 'deep.js', parentId: 'lib' }),
  node({ id: 'index', name: 'index.js', parentId: 'src' }),
  node({ id: 'pkg', name: 'package.json' }),
]);

describe('visibleRows', () => {
  it('shows only top-level rows when nothing is expanded', () => {
    expect(visibleRows(tree, new Set()).map((row) => row.id)).toEqual(['empty', 'src', 'pkg']);
  });

  it('descends into expanded folders, depth first, with ARIA positions', () => {
    const rows = visibleRows(tree, new Set(['src', 'lib']));
    expect(rows.map((row) => [row.id, row.level, row.posInSet, row.setSize])).toEqual([
      ['empty', 1, 1, 3],
      ['src', 1, 2, 3],
      ['lib', 2, 1, 2],
      ['deep', 3, 1, 1],
      ['index', 2, 2, 2],
      ['pkg', 1, 3, 3],
    ]);
    expect(rows.find((row) => row.id === 'src')).toMatchObject({
      expanded: true,
      hasChildren: true,
    });
    expect(rows.find((row) => row.id === 'empty')).toMatchObject({
      expanded: false,
      hasChildren: false,
    });
  });

  it('hides children of a collapsed folder even if a descendant is expanded', () => {
    expect(visibleRows(tree, new Set(['lib'])).map((row) => row.id)).toEqual([
      'empty',
      'src',
      'pkg',
    ]);
  });
});

describe('ancestorIds', () => {
  it('lists folders from the root down', () => {
    expect(ancestorIds(tree, 'deep')).toEqual(['src', 'lib']);
    expect(ancestorIds(tree, 'pkg')).toEqual([]);
  });
});

describe('draftInsertIndex', () => {
  it('goes first inside the folder, or at the top for the root', () => {
    const rows = visibleRows(tree, new Set(['src']));
    expect(draftInsertIndex(rows, null)).toBe(0);
    expect(draftInsertIndex(rows, 'src')).toBe(2);
    expect(draftInsertIndex(rows, 'missing')).toBe(0);
  });
});
