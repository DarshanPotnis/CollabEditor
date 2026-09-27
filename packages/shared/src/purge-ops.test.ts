import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { listDeletedItems, purgeTargets } from './deleted-items.js';
import { OpError } from './op-error.js';
import { purgeDeleted } from './purge-ops.js';
import { contentsMap, nodesMap, readFileContent } from './schema.js';
import { createFile, createFolder, resolveDocTree, restore, softDelete } from './tree-ops.js';

const alice = { userId: 'alice', userName: 'Alice', now: 1_000 };
const bob = { userId: 'bob', userName: 'Bob', now: 2_000 };
const later = { userId: 'bob', userName: 'Bob', now: 3_000 };

function paths(doc: Y.Doc): string[] {
  return [...resolveDocTree(doc).byId.values()].map((node) => node.path).sort();
}

function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

/** src/{routes/{users.js, old.js}, index.js} */
function project(): { doc: Y.Doc; src: string; routes: string; users: string; old: string } {
  const doc = new Y.Doc();
  const src = createFolder(doc, { parentId: null, name: 'src' }, alice);
  const routes = createFolder(doc, { parentId: src, name: 'routes' }, alice);
  const users = createFile(doc, { parentId: routes, name: 'users.js', content: 'u' }, alice);
  const old = createFile(doc, { parentId: routes, name: 'old.js', content: 'o' }, alice);
  createFile(doc, { parentId: src, name: 'index.js' }, alice);
  return { doc, src, routes, users, old };
}

describe('listDeletedItems', () => {
  it('lists the top of each deleted subtree with where it was and who deleted it', () => {
    const { doc, routes, old } = project();
    softDelete(doc, old, alice);
    softDelete(doc, routes, later);

    expect(listDeletedItems(resolveDocTree(doc))).toEqual([
      {
        id: routes,
        kind: 'folder',
        name: 'routes',
        folderPath: 'src',
        deletedAt: 3_000,
        deletedBy: 'bob',
        deletedByName: 'Bob',
        containedCount: 2,
      },
    ]);
  });

  it('lists a separately deleted file again once its folder is restored', () => {
    const { doc, routes, old } = project();
    softDelete(doc, old, alice);
    softDelete(doc, routes, later);
    restore(doc, routes);

    const items = listDeletedItems(resolveDocTree(doc));
    expect(items.map((item) => [item.id, item.folderPath])).toEqual([[old, 'src/routes']]);
  });

  it('orders newest first and reports root items with a null folder', () => {
    const doc = new Y.Doc();
    const a = createFile(doc, { parentId: null, name: 'a.js' }, alice);
    const b = createFile(doc, { parentId: null, name: 'b.js' }, alice);
    softDelete(doc, a, alice);
    softDelete(doc, b, later);

    const items = listDeletedItems(resolveDocTree(doc));
    expect(items.map((item) => item.id)).toEqual([b, a]);
    expect(items[0]?.folderPath).toBeNull();
  });
});

describe('purgeTargets', () => {
  it('refuses an id that is not an item', () => {
    const { doc, routes, users } = project();
    softDelete(doc, routes, bob);
    expect(purgeTargets(resolveDocTree(doc), [users])).toBeNull();
    expect(purgeTargets(resolveDocTree(doc), ['nope'])).toBeNull();
  });
});

describe('purgeDeleted', () => {
  it('removes an item, everything under it, and their content', () => {
    const { doc, routes, users, old } = project();
    softDelete(doc, routes, bob);
    const before = nodesMap(doc).size;

    const result = purgeDeleted(doc, [routes]);

    expect(result.purgedIds.sort()).toEqual([routes, users, old].sort());
    expect(nodesMap(doc).size).toBe(before - 3);
    expect(contentsMap(doc).has(users)).toBe(false);
    expect(listDeletedItems(resolveDocTree(doc))).toEqual([]);
    expect(paths(doc)).toEqual(['src', 'src/index.js']);
  });

  it('empties everything with "all"', () => {
    const { doc, src } = project();
    const loose = createFile(doc, { parentId: null, name: 'loose.js' }, alice);
    softDelete(doc, loose, bob);
    softDelete(doc, src, bob);

    purgeDeleted(doc, 'all');
    expect(nodesMap(doc).size).toBe(0);
    expect(contentsMap(doc).size).toBe(0);
  });

  it('is a no-op with nothing deleted', () => {
    const { doc } = project();
    expect(purgeDeleted(doc, 'all')).toEqual({ purgedIds: [] });
  });

  it('refuses a visible node, or an item someone restored meanwhile', () => {
    const { doc, routes, users } = project();
    expect(() => purgeDeleted(doc, [users])).toThrow(OpError);
    softDelete(doc, routes, bob);
    restore(doc, routes);
    expect(() => purgeDeleted(doc, [routes])).toThrow(/no longer in Recently deleted/);
  });

  it('frees room under the total node cap', () => {
    const { doc, routes } = project();
    softDelete(doc, routes, bob);
    const before = nodesMap(doc).size;
    purgeDeleted(doc, [routes]);
    expect(nodesMap(doc).size).toBeLessThan(before);
  });
});

describe('purge under concurrency', () => {
  it('keeps a child created concurrently inside a purged folder, at the root', () => {
    const { doc: a, routes } = project();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // A deletes and purges routes/; B, not having seen either, adds a file to it.
    softDelete(a, routes, alice);
    purgeDeleted(a, [routes]);
    const auth = createFile(b, { parentId: routes, name: 'auth.js', content: 'kept' }, bob);
    exchange(a, b);

    for (const doc of [a, b]) {
      expect(nodesMap(doc).has(routes)).toBe(false);
      expect(resolveDocTree(doc).byId.get(auth)).toMatchObject({ path: 'auth.js', parentId: null });
      expect(resolveDocTree(doc).conflicts).toEqual([{ nodeId: auth, kind: 'missing-parent' }]);
      expect(readFileContent(doc, auth)).toBe('kept');
    }
  });

  it('restore versus purge at the same moment: the purge wins, identically everywhere', () => {
    const { doc: a, routes, users } = project();
    softDelete(a, routes, alice);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    restore(a, routes);
    purgeDeleted(b, [routes]);
    exchange(a, b);

    for (const doc of [a, b]) {
      expect(nodesMap(doc).has(routes)).toBe(false);
      expect(nodesMap(doc).has(users)).toBe(false);
      expect(contentsMap(doc).has(users)).toBe(false);
      expect(paths(doc)).toEqual(['src', 'src/index.js']);
    }
  });

  it('restore-then-create versus purge: the restored folder goes, its new file survives at root', () => {
    const { doc: a, routes } = project();
    softDelete(a, routes, alice);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    restore(a, routes);
    const fresh = createFile(a, { parentId: routes, name: 'fresh.js' }, alice);
    purgeDeleted(b, [routes]);
    exchange(a, b);

    expect(paths(a)).toEqual(['fresh.js', 'src', 'src/index.js']);
    expect(paths(b)).toEqual(paths(a));
    expect(resolveDocTree(b).byId.has(fresh)).toBe(true);
  });
});
