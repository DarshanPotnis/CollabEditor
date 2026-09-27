import { describe, expect, it } from 'vitest';
import { resolveTree } from '@collabcode/shared';
import { treeKeyAction } from './tree-keyboard.js';
import { visibleRows } from './visible-rows.js';
import { node } from '../../test/nodes.js';

const tree = resolveTree([
  node({ id: 'src', name: 'src', kind: 'folder' }),
  node({ id: 'empty', name: 'empty', kind: 'folder', parentId: 'src' }),
  node({ id: 'index', name: 'index.js', parentId: 'src' }),
  node({ id: 'pkg', name: 'package.json' }),
]);

const collapsed = visibleRows(tree, new Set());
const open = visibleRows(tree, new Set(['src', 'empty']));

const key = (
  name: string,
  modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {},
) => ({
  key: name,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

describe('treeKeyAction', () => {
  it('moves up and down through visible rows, and to the ends', () => {
    expect(treeKeyAction(key('ArrowDown'), open, 'src')).toEqual({ type: 'focus', id: 'empty' });
    expect(treeKeyAction(key('ArrowUp'), open, 'empty')).toEqual({ type: 'focus', id: 'src' });
    expect(treeKeyAction(key('ArrowUp'), open, 'src')).toEqual({ type: 'none' });
    expect(treeKeyAction(key('End'), open, 'src')).toEqual({ type: 'focus', id: 'pkg' });
    expect(treeKeyAction(key('Home'), open, 'pkg')).toEqual({ type: 'focus', id: 'src' });
  });

  it('focuses the first row when nothing is focused yet', () => {
    expect(treeKeyAction(key('ArrowDown'), open, null)).toEqual({ type: 'focus', id: 'src' });
    expect(treeKeyAction(key('ArrowDown'), [], null)).toEqual({ type: 'none' });
  });

  it('ArrowRight expands a closed folder, then enters it', () => {
    expect(treeKeyAction(key('ArrowRight'), collapsed, 'src')).toEqual({
      type: 'expand',
      id: 'src',
    });
    expect(treeKeyAction(key('ArrowRight'), open, 'src')).toEqual({ type: 'focus', id: 'empty' });
    expect(treeKeyAction(key('ArrowRight'), open, 'empty')).toEqual({ type: 'none' });
    expect(treeKeyAction(key('ArrowRight'), open, 'index')).toEqual({ type: 'none' });
  });

  it('ArrowLeft collapses an open folder, otherwise goes to the parent', () => {
    expect(treeKeyAction(key('ArrowLeft'), open, 'src')).toEqual({ type: 'collapse', id: 'src' });
    expect(treeKeyAction(key('ArrowLeft'), open, 'index')).toEqual({ type: 'focus', id: 'src' });
    expect(treeKeyAction(key('ArrowLeft'), open, 'pkg')).toEqual({ type: 'none' });
  });

  it('Enter and Space open a file or toggle a folder', () => {
    expect(treeKeyAction(key('Enter'), open, 'index')).toEqual({ type: 'open', id: 'index' });
    expect(treeKeyAction(key(' '), open, 'src')).toEqual({ type: 'collapse', id: 'src' });
    expect(treeKeyAction(key('Enter'), collapsed, 'src')).toEqual({ type: 'expand', id: 'src' });
  });

  it('F2 renames; Delete, or Cmd+Backspace on a Mac, deletes', () => {
    expect(treeKeyAction(key('F2'), open, 'index')).toEqual({ type: 'rename', id: 'index' });
    expect(treeKeyAction(key('Delete'), open, 'index')).toEqual({ type: 'delete', id: 'index' });
    expect(treeKeyAction(key('Backspace', { metaKey: true }), open, 'index')).toEqual({
      type: 'delete',
      id: 'index',
    });
    expect(treeKeyAction(key('Backspace'), open, 'index')).toEqual({ type: 'none' });
  });

  it('Shift+F10 and the Menu key open the context menu', () => {
    expect(treeKeyAction(key('F10', { shiftKey: true }), open, 'src')).toEqual({
      type: 'menu',
      id: 'src',
    });
    expect(treeKeyAction(key('ContextMenu'), open, 'src')).toEqual({ type: 'menu', id: 'src' });
    expect(treeKeyAction(key('F10'), open, 'src')).toEqual({ type: 'none' });
  });

  it('leaves Ctrl shortcuts alone', () => {
    expect(treeKeyAction(key('ArrowDown', { ctrlKey: true }), open, 'src')).toEqual({
      type: 'none',
    });
  });
});
