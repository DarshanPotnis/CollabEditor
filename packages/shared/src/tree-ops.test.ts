import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MAX_FILE_SIZE, MAX_LIVE_NODES, MAX_TOTAL_NODES } from './limits.js';
import { insertNode } from './node-writer.js';
import { OPS_ORIGIN, OpError, type OpErrorCode } from './op-error.js';
import { nodesMap, readFileContent, readNode } from './schema.js';
import {
  createFile,
  createFolder,
  move,
  rename,
  resolveDocTree,
  restore,
  softDelete,
} from './tree-ops.js';

const alice = { userId: 'alice', userName: 'Alice', now: 1_000 };
const bob = { userId: 'bob', userName: 'Bob', now: 2_000 };

function paths(doc: Y.Doc): string[] {
  return [...resolveDocTree(doc).byId.values()].map((node) => node.path).sort();
}

function expectOpError(action: () => unknown, code: OpErrorCode, message?: RegExp): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OpError);
    expect((error as OpError).code).toBe(code);
    if (message) expect((error as OpError).message).toMatch(message);
    return;
  }
  throw new Error(`expected OpError ${code}, but nothing was thrown`);
}

/** A project with src/index.js and src/lib/. */
function project(): { doc: Y.Doc; src: string; lib: string; index: string } {
  const doc = new Y.Doc();
  const src = createFolder(doc, { parentId: null, name: 'src' }, alice);
  const lib = createFolder(doc, { parentId: src, name: 'lib' }, alice);
  const index = createFile(doc, { parentId: src, name: 'index.js', content: 'hi' }, alice);
  return { doc, src, lib, index };
}

describe('createFile and createFolder', () => {
  it('create nodes with their fields and content', () => {
    const { doc, index } = project();
    expect(paths(doc)).toEqual(['src', 'src/index.js', 'src/lib']);
    expect(readNode(doc, index)).toMatchObject({
      kind: 'file',
      name: 'index.js',
      createdAt: 1_000,
      createdBy: 'alice',
      deletedAt: null,
      deletedBy: null,
    });
    expect(readFileContent(doc, index)).toBe('hi');
  });

  it('give folders no content', () => {
    const { doc, src } = project();
    expect(readFileContent(doc, src)).toBeUndefined();
  });

  it('run in one transaction tagged with the ops origin', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    createFile(doc, { parentId: null, name: 'a.js' }, alice);
    expect(origins).toEqual([OPS_ORIGIN]);
  });

  it('refuse an exact duplicate with a message naming the folder', () => {
    const { doc, src } = project();
    expectOpError(
      () => createFile(doc, { parentId: src, name: 'index.js' }, bob),
      'duplicate-name',
      /A file named "index.js" already exists in src\./,
    );
  });

  it('refuse a name that differs only in case, and explain why', () => {
    const { doc, src } = project();
    expectOpError(
      () => createFile(doc, { parentId: src, name: 'Index.js' }, bob),
      'duplicate-name',
      /capitalisation/,
    );
    expectOpError(() => createFolder(doc, { parentId: null, name: 'SRC' }, bob), 'duplicate-name');
  });

  it('refuse a file with the same name as a folder', () => {
    const { doc, src } = project();
    expectOpError(
      () => createFile(doc, { parentId: src, name: 'lib' }, bob),
      'duplicate-name',
      /A folder named "lib"/,
    );
  });

  it('allow a name that a deleted sibling had', () => {
    const { doc, src, index } = project();
    softDelete(doc, index, bob);
    createFile(doc, { parentId: src, name: 'index.js' }, bob);
    expect(paths(doc)).toContain('src/index.js');
  });

  it('refuse invalid names', () => {
    const doc = new Y.Doc();
    for (const name of ['', 'a/b', '..', ' padded']) {
      expectOpError(() => createFile(doc, { parentId: null, name }, alice), 'invalid-name');
    }
  });

  it('store names NFC-normalised, so two spellings of é clash', () => {
    const doc = new Y.Doc();
    const id = createFile(doc, { parentId: null, name: 'café.js' }, alice);
    expect(readNode(doc, id)?.name).toBe('café.js');
    expectOpError(
      () => createFile(doc, { parentId: null, name: 'café.js' }, bob),
      'duplicate-name',
    );
  });

  it('refuse a parent that is missing, a file, or deleted', () => {
    const { doc, lib, index } = project();
    softDelete(doc, lib, alice);
    for (const parentId of ['nope', index, lib]) {
      expectOpError(() => createFile(doc, { parentId, name: 'x.js' }, alice), 'invalid-parent');
    }
  });

  it('refuse content over the per-file limit', () => {
    const doc = new Y.Doc();
    expectOpError(
      () =>
        createFile(
          doc,
          { parentId: null, name: 'big.txt', content: 'x'.repeat(MAX_FILE_SIZE + 1) },
          alice,
        ),
      'file-too-large',
    );
  });
});

describe('node limits', () => {
  function fill(doc: Y.Doc, count: number, deleted: boolean): void {
    doc.transact(() => {
      for (let index = 0; index < count; index += 1) {
        insertNode(doc, {
          id: `n${String(index)}`,
          kind: 'folder',
          name: `n${String(index)}`,
          parentId: null,
          createdAt: 1,
          createdBy: 'seed',
          deletedAt: deleted ? 5 : null,
          deletedBy: null,
          deletedByName: null,
        });
      }
    });
  }

  it('refuse a create at the live-node limit', () => {
    const doc = new Y.Doc();
    fill(doc, MAX_LIVE_NODES, false);
    expectOpError(
      () => createFile(doc, { parentId: null, name: 'one-more.js' }, alice),
      'too-many-nodes',
      /limit of 500 files and folders/,
    );
  });

  it('refuse a create at the total limit, counting deleted nodes, and say so', () => {
    const doc = new Y.Doc();
    fill(doc, MAX_TOTAL_NODES, true);
    expect(resolveDocTree(doc).byId.size).toBe(0);
    expectOpError(
      () => createFolder(doc, { parentId: null, name: 'one-more' }, alice),
      'too-many-nodes-total',
      /2,000 files and folders, counting deleted ones/,
    );
  });
});

describe('rename', () => {
  it('changes the name and keeps the id and content', () => {
    const { doc, index } = project();
    rename(doc, index, 'server.js');
    expect(paths(doc)).toContain('src/server.js');
    expect(readFileContent(doc, index)).toBe('hi');
  });

  it('allows changing only the case of its own name', () => {
    const { doc, index } = project();
    rename(doc, index, 'Index.js');
    expect(readNode(doc, index)?.name).toBe('Index.js');
  });

  it('does nothing when the name is unchanged', () => {
    const { doc, index } = project();
    const onUpdate = vi.fn();
    doc.on('update', onUpdate);
    rename(doc, index, 'index.js');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('refuses a clash, including by case', () => {
    const { doc, src, index } = project();
    createFile(doc, { parentId: src, name: 'app.js' }, alice);
    expectOpError(() => rename(doc, index, 'APP.js'), 'duplicate-name');
  });

  it('refuses a hidden node', () => {
    const { doc, index } = project();
    softDelete(doc, index, alice);
    expectOpError(() => rename(doc, index, 'x.js'), 'not-found');
  });
});

describe('move', () => {
  it('re-parents a node, and null means root', () => {
    const { doc, lib, index } = project();
    move(doc, index, lib);
    expect(paths(doc)).toContain('src/lib/index.js');
    move(doc, index, null);
    expect(paths(doc)).toContain('index.js');
  });

  it('refuses moving a folder into itself or its descendants', () => {
    const { doc, src, lib } = project();
    expectOpError(() => move(doc, src, lib), 'would-create-cycle');
    expectOpError(() => move(doc, src, src), 'would-create-cycle');
  });

  it('refuses a name clash in the target, including by case', () => {
    const { doc, lib, index } = project();
    createFile(doc, { parentId: lib, name: 'INDEX.JS' }, alice);
    expectOpError(() => move(doc, index, lib), 'duplicate-name');
  });

  it('refuses a missing node or target', () => {
    const { doc, index } = project();
    expectOpError(() => move(doc, 'nope', null), 'not-found');
    expectOpError(() => move(doc, index, 'nope'), 'invalid-parent');
  });

  it('writes nothing when the node is already there', () => {
    const { doc, src, index } = project();
    const onUpdate = vi.fn();
    doc.on('update', onUpdate);
    move(doc, index, src);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('softDelete', () => {
  it('tombstones the node, records who, and keeps content', () => {
    const { doc, index } = project();
    softDelete(doc, index, bob);
    expect(readNode(doc, index)).toMatchObject({
      deletedAt: 2_000,
      deletedBy: 'bob',
      deletedByName: 'Bob',
    });
    expect(readFileContent(doc, index)).toBe('hi');
    expect(resolveDocTree(doc).hidden.get(index)?.deletedBy).toBe('bob');
  });

  it('hides a folder and everything under it without touching the children', () => {
    const { doc, src, index } = project();
    softDelete(doc, src, bob);
    expect(paths(doc)).toEqual([]);
    expect(readNode(doc, index)?.deletedAt).toBeNull();
  });

  it('refuses a node that is already hidden', () => {
    const { doc, src, index } = project();
    softDelete(doc, src, bob);
    expectOpError(() => softDelete(doc, index, bob), 'not-found');
  });
});

describe('restore', () => {
  it('clears the tombstone', () => {
    const { doc, index } = project();
    softDelete(doc, index, bob);
    expect(restore(doc, index)).toEqual({ restoredIds: [index], renamed: [] });
    expect(readNode(doc, index)).toMatchObject({
      deletedAt: null,
      deletedBy: null,
      deletedByName: null,
    });
  });

  it('restores a file hidden by its deleted folder by restoring the folder', () => {
    const { doc, src, index } = project();
    softDelete(doc, src, bob);
    expect(restore(doc, index).restoredIds).toEqual([src]);
    expect(paths(doc)).toEqual(['src', 'src/index.js', 'src/lib']);
  });

  it('clears every tombstone on the way up, top first', () => {
    const { doc, src, lib } = project();
    const deep = createFile(doc, { parentId: lib, name: 'deep.js' }, alice);
    softDelete(doc, deep, alice);
    softDelete(doc, src, bob);
    expect(restore(doc, deep).restoredIds).toEqual([src, deep]);
    expect(paths(doc)).toContain('src/lib/deep.js');
  });

  it('leaves a sibling deleted separately still deleted', () => {
    const { doc, src, lib, index } = project();
    softDelete(doc, lib, alice);
    softDelete(doc, src, bob);
    restore(doc, index);
    expect(paths(doc)).toEqual(['src', 'src/index.js']);
  });

  it('renames the restored node when its name was taken meanwhile', () => {
    const { doc, src, index } = project();
    softDelete(doc, index, bob);
    const replacement = createFile(doc, { parentId: src, name: 'index.js' }, alice);

    const result = restore(doc, index);
    expect(result.renamed).toEqual([{ id: index, from: 'index.js', to: 'index (2).js' }]);
    expect(readNode(doc, replacement)?.name).toBe('index.js');
    expect(paths(doc)).toEqual(['src', 'src/index (2).js', 'src/index.js', 'src/lib']);
    expect(resolveDocTree(doc).conflicts).toEqual([]);
  });

  it('renames on a case-only clash too', () => {
    const { doc, src, index } = project();
    softDelete(doc, index, bob);
    createFile(doc, { parentId: src, name: 'INDEX.js' }, alice);
    expect(restore(doc, index).renamed[0]?.to).toBe('index (2).js');
  });

  it('is a no-op on a node that is not deleted', () => {
    const { doc, index } = project();
    expect(restore(doc, index)).toEqual({ restoredIds: [], renamed: [] });
  });

  it('gives the same result when two people restore at once', () => {
    const { doc, index } = project();
    softDelete(doc, index, bob);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

    restore(doc, index);
    restore(other, index);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

    expect(paths(doc)).toEqual(paths(other));
    expect(paths(doc)).toContain('src/index.js');
  });

  it('refuses an unknown id', () => {
    expectOpError(() => restore(new Y.Doc(), 'nope'), 'not-found');
  });
});

describe('origin', () => {
  it('tags every op with the origin it is given, for undo tracking', () => {
    const { doc, src, lib, index } = project();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    const tag = 'collabcode:agent:test';

    const file = createFile(doc, { parentId: null, name: 'a.js' }, alice, tag);
    createFolder(doc, { parentId: null, name: 'b' }, alice, tag);
    rename(doc, file, 'c.js', tag);
    move(doc, file, lib, tag);
    softDelete(doc, index, alice, tag);
    restore(doc, index, tag);
    softDelete(doc, src, alice);

    expect(origins).toEqual([tag, tag, tag, tag, tag, tag, OPS_ORIGIN]);
  });
});

describe('concurrency: what write-time checks cannot see', () => {
  function replicas(): [Y.Doc, Y.Doc] {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const syncAll = (): void => {
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    };
    syncAll();
    return [a, b];
  }

  function exchange(a: Y.Doc, b: Y.Doc): void {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  }

  it('two offline creates of utils.js both survive, one shown as utils (2).js', () => {
    const [a, b] = replicas();
    createFile(a, { parentId: null, name: 'utils.js' }, alice);
    createFile(b, { parentId: null, name: 'utils.js' }, bob);
    exchange(a, b);

    expect(paths(a)).toEqual(['utils (2).js', 'utils.js']);
    expect(paths(b)).toEqual(paths(a));
  });

  it('concurrent cross-moves resolve to the same tree on both sides', () => {
    const [a, b] = replicas();
    const x = createFolder(a, { parentId: null, name: 'X' }, alice);
    const y = createFolder(a, { parentId: null, name: 'Y' }, bob);
    exchange(a, b);

    move(a, x, y);
    move(b, y, x);
    exchange(a, b);

    expect(paths(a)).toEqual(['X', 'X/Y']);
    expect(paths(b)).toEqual(paths(a));
    expect(resolveDocTree(a).conflicts).toEqual([{ nodeId: x, kind: 'cycle', others: [y] }]);
  });

  it('a file created in a concurrently deleted folder is hidden with it', () => {
    const [a, b] = replicas();
    const routes = createFolder(a, { parentId: null, name: 'routes' }, alice);
    exchange(a, b);

    softDelete(a, routes, alice);
    const auth = createFile(b, { parentId: routes, name: 'auth.js' }, bob);
    exchange(a, b);

    expect(paths(b)).toEqual([]);
    expect(resolveDocTree(b).hidden.get(auth)?.causeId).toBe(routes);
  });

  it('a concurrent rename and move of one node both apply', () => {
    const [a, b] = replicas();
    const dir = createFolder(a, { parentId: null, name: 'dir' }, alice);
    const file = createFile(a, { parentId: null, name: 'a.js' }, alice);
    exchange(a, b);

    rename(a, file, 'b.js');
    move(b, file, dir);
    exchange(a, b);

    expect(paths(a)).toEqual(['dir', 'dir/b.js']);
    expect(nodesMap(a).get(file)?.get('name')).toBe('b.js');
  });
});
