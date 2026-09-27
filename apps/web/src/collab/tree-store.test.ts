import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createFile, readFileText, rename } from '@collabcode/shared';
import { createTreeStore } from './tree-store.js';

const alice = { userId: 'alice', userName: 'Alice' };

describe('createTreeStore', () => {
  it('resolves on creation and after each structural change', () => {
    const doc = new Y.Doc();
    const store = createTreeStore(doc);
    expect(store.getSnapshot().byId.size).toBe(0);

    const id = createFile(doc, { parentId: null, name: 'a.js' }, alice);
    expect(store.getSnapshot().byId.get(id)?.path).toBe('a.js');

    rename(doc, id, 'b.js');
    expect(store.getSnapshot().byId.get(id)?.path).toBe('b.js');
    store.destroy();
  });

  it('keeps the same snapshot and notifies nobody while someone types', () => {
    const doc = new Y.Doc();
    const id = createFile(doc, { parentId: null, name: 'a.js' }, alice);
    const store = createTreeStore(doc);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    readFileText(doc, id)?.insert(0, 'typing');

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    store.destroy();
  });

  it('notifies subscribers, and stops after unsubscribe or destroy', () => {
    const doc = new Y.Doc();
    const store = createTreeStore(doc);
    const kept = vi.fn();
    const dropped = vi.fn();
    store.subscribe(kept);
    const unsubscribe = store.subscribe(dropped);
    unsubscribe();

    createFile(doc, { parentId: null, name: 'a.js' }, alice);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();

    store.destroy();
    createFile(doc, { parentId: null, name: 'b.js' }, alice);
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('sees remote changes', () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    const store = createTreeStore(local);
    createFile(remote, { parentId: null, name: 'remote.js' }, alice);
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));
    expect(store.getSnapshot().idByPath.has('remote.js')).toBe(true);
    store.destroy();
  });
});
