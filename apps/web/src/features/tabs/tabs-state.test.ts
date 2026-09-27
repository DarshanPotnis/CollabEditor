import { describe, expect, it } from 'vitest';
import { resolveTree } from '@collabcode/shared';
import { node } from '../../test/nodes.js';
import { EMPTY_TABS, tabHints, tabStatus, tabsReducer, type TabsState } from './tabs-state.js';

function open(state: TabsState, ...ids: string[]): TabsState {
  return ids.reduce((current, id) => tabsReducer(current, { type: 'open', id, name: id }), state);
}

describe('tabsReducer', () => {
  it('opens a new tab to the right of the active one and activates it', () => {
    let state = open(EMPTY_TABS, 'a', 'b');
    state = tabsReducer(state, { type: 'activate', id: 'a' });
    state = open(state, 'c');
    expect(state.tabs.map((tab) => tab.id)).toEqual(['a', 'c', 'b']);
    expect(state.activeId).toBe('c');
  });

  it('activates an already open tab instead of opening it twice', () => {
    const state = open(EMPTY_TABS, 'a', 'b', 'a');
    expect(state.tabs.map((tab) => tab.id)).toEqual(['a', 'b']);
    expect(state.activeId).toBe('a');
  });

  it('closing the active tab activates the one to its right, else its left, else none', () => {
    let state = open(EMPTY_TABS, 'a', 'b', 'c');
    state = tabsReducer(state, { type: 'activate', id: 'b' });
    state = tabsReducer(state, { type: 'close', id: 'b' });
    expect(state.activeId).toBe('c');
    state = tabsReducer(state, { type: 'close', id: 'c' });
    expect(state.activeId).toBe('a');
    state = tabsReducer(state, { type: 'close', id: 'a' });
    expect(state).toEqual(EMPTY_TABS);
  });

  it('closing a background tab keeps the active one', () => {
    let state = open(EMPTY_TABS, 'a', 'b');
    state = tabsReducer(state, { type: 'close', id: 'a' });
    expect(state).toEqual({ tabs: [{ id: 'b', lastName: 'b' }], activeId: 'b' });
  });

  it('ignores activating or closing an unknown tab', () => {
    const state = open(EMPTY_TABS, 'a');
    expect(tabsReducer(state, { type: 'activate', id: 'x' })).toBe(state);
    expect(tabsReducer(state, { type: 'close', id: 'x' })).toBe(state);
  });

  it('remembers current names, including for deleted files, and keeps them once purged', () => {
    let state = open(EMPTY_TABS, 'f', 'g');
    const tree = resolveTree([
      node({ id: 'f', name: 'renamed.js' }),
      node({ id: 'g', name: 'gone.js', deletedAt: 5 }),
    ]);
    state = tabsReducer(state, { type: 'remember', tree });
    expect(state.tabs.map((tab) => tab.lastName)).toEqual(['renamed.js', 'gone.js']);

    const purged = tabsReducer(state, { type: 'remember', tree: resolveTree([]) });
    expect(purged).toBe(state);
  });
});

describe('tabStatus', () => {
  const tree = resolveTree([
    node({ id: 'live', name: 'a.js' }),
    node({ id: 'dead', name: 'b.js', deletedAt: 5, deletedBy: 'u2', deletedByName: 'Bob' }),
  ]);

  it('tells live, deleted and permanently deleted files apart', () => {
    expect(tabStatus(tree, 'live').kind).toBe('live');
    expect(tabStatus(tree, 'dead')).toMatchObject({
      kind: 'deleted',
      hidden: { deletedByName: 'Bob' },
    });
    expect(tabStatus(tree, 'nope')).toEqual({ kind: 'purged' });
  });
});

describe('tabHints', () => {
  it('adds the folder only when two open tabs share a name', () => {
    const tree = resolveTree([
      node({ id: 'src', name: 'src', kind: 'folder' }),
      node({ id: 'a', name: 'index.js', parentId: 'src' }),
      node({ id: 'b', name: 'index.js' }),
      node({ id: 'c', name: 'util.js' }),
    ]);
    const tabs = [
      { id: 'a', lastName: 'index.js' },
      { id: 'b', lastName: 'index.js' },
      { id: 'c', lastName: 'util.js' },
    ];
    expect(Object.fromEntries(tabHints(tabs, tree))).toEqual({
      a: 'src',
      b: 'project root',
      c: null,
    });
  });
});
