import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { resolveTree, type ResolvedTree } from './resolve-tree.js';
import { nodesMap, readAllNodes, type NodeFieldValue, type NodeFields } from './schema.js';

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

const folder = (overrides: Partial<NodeFields> & Pick<NodeFields, 'id' | 'name'>): NodeFields =>
  node({ kind: 'folder', ...overrides });

function paths(tree: ResolvedTree): string[] {
  return [...tree.byId.values()].map((resolved) => resolved.path).sort();
}

/** Everything observable about a resolved tree, as plain comparable data. */
function snapshot(tree: ResolvedTree): unknown {
  return {
    nodes: [...tree.byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    children: [...tree.childrenOf.entries()].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
    hidden: [...tree.hidden.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    conflicts: tree.conflicts,
  };
}

describe('resolveTree basics', () => {
  it('builds paths, depth and lookup by path', () => {
    const tree = resolveTree([
      folder({ id: 'src', name: 'src' }),
      folder({ id: 'routes', name: 'routes', parentId: 'src' }),
      node({ id: 'users', name: 'users.js', parentId: 'routes' }),
      node({ id: 'pkg', name: 'package.json' }),
    ]);

    expect(tree.byId.get('users')).toMatchObject({ path: 'src/routes/users.js', depth: 2 });
    expect(tree.idByPath.get('src/routes')).toBe('routes');
    expect(tree.conflicts).toEqual([]);
    expect(tree.hidden.size).toBe(0);
  });

  it('orders siblings folders first, then case-insensitively, then exactly, then by id', () => {
    const tree = resolveTree([
      node({ id: 'b', name: 'b.js' }),
      node({ id: 'A', name: 'A.js' }),
      node({ id: 'a', name: 'a.js' }),
      folder({ id: 'z', name: 'zeta' }),
      node({ id: 'c', name: 'C.js' }),
    ]);

    expect(tree.childrenOf.get(null)).toEqual(['z', 'A', 'a', 'b', 'c']);
  });

  it('returns an empty tree for no nodes', () => {
    const tree = resolveTree([]);
    expect(tree.byId.size).toBe(0);
    expect(tree.childrenOf.get(null)).toEqual([]);
  });
});

describe('rule: deletion cascade', () => {
  const nodes = [
    folder({ id: 'routes', name: 'routes', deletedAt: 500, deletedBy: 'alice' }),
    node({ id: 'users', name: 'users.js', parentId: 'routes' }),
    folder({ id: 'deep', name: 'deep', parentId: 'routes' }),
    node({ id: 'leaf', name: 'leaf.js', parentId: 'deep' }),
    node({ id: 'index', name: 'index.js' }),
  ];

  it('hides a deleted folder and everything under it', () => {
    const tree = resolveTree(nodes);
    expect(paths(tree)).toEqual(['index.js']);
    expect([...tree.hidden.keys()].sort()).toEqual(['deep', 'leaf', 'routes', 'users']);
  });

  it('records the tombstone that hid each node, and who made it', () => {
    const tree = resolveTree(nodes);
    expect(tree.hidden.get('leaf')).toMatchObject({
      causeId: 'routes',
      deletedAt: 500,
      deletedBy: 'alice',
    });
  });

  it('reports the nearest tombstone when a node and its ancestor are both deleted', () => {
    const tree = resolveTree([
      folder({ id: 'routes', name: 'routes', deletedAt: 900, deletedBy: 'bob' }),
      node({ id: 'users', name: 'users.js', parentId: 'routes', deletedAt: 300 }),
    ]);
    expect(tree.hidden.get('users')?.causeId).toBe('users');
  });

  it('hides a file created in a folder that was concurrently deleted', () => {
    // A deleted routes/ while B, not having seen that, created routes/auth.js.
    const tree = resolveTree([
      folder({ id: 'routes', name: 'routes', deletedAt: 500, deletedBy: 'alice' }),
      node({ id: 'auth', name: 'auth.js', parentId: 'routes', createdAt: 600 }),
    ]);
    expect(tree.byId.has('auth')).toBe(false);
    expect(tree.hidden.get('auth')?.causeId).toBe('routes');
  });

  it('brings children back when the folder tombstone is cleared', () => {
    const restored = nodes.map((each) =>
      each.id === 'routes' ? { ...each, deletedAt: null, deletedBy: null } : each,
    );
    expect(paths(resolveTree(restored))).toEqual([
      'index.js',
      'routes',
      'routes/deep',
      'routes/deep/leaf.js',
      'routes/users.js',
    ]);
  });
});

describe('rule: missing parent', () => {
  it('puts a node whose parent does not exist at the root', () => {
    const tree = resolveTree([node({ id: 'helpers', name: 'helpers.js', parentId: 'gone' })]);
    expect(tree.byId.get('helpers')).toMatchObject({ path: 'helpers.js', parentId: null });
    expect(tree.conflicts).toEqual([{ nodeId: 'helpers', kind: 'missing-parent' }]);
  });

  it('treats a file as a missing parent', () => {
    const tree = resolveTree([
      node({ id: 'file', name: 'a.js' }),
      node({ id: 'child', name: 'b.js', parentId: 'file' }),
    ]);
    expect(tree.byId.get('child')?.path).toBe('b.js');
    expect(tree.conflicts).toEqual([{ nodeId: 'child', kind: 'missing-parent' }]);
  });

  it('resolves children of a node that was dropped for being malformed', () => {
    const doc = new Y.Doc();
    const nodes = nodesMap(doc);
    nodes.set(
      'lib',
      new Y.Map<NodeFieldValue>([
        ['id', 'lib'],
        ['kind', 'folder'],
        ['name', ''],
      ]),
    );
    nodes.set(
      'helpers',
      new Y.Map<NodeFieldValue>(
        Object.entries(node({ id: 'helpers', name: 'helpers.js', parentId: 'lib' })),
      ),
    );

    const tree = resolveTree(readAllNodes(doc));
    expect(paths(tree)).toEqual(['helpers.js']);
    doc.destroy();
  });
});

describe('rule: cycles', () => {
  it('breaks a two-folder cycle at the older folder', () => {
    // A moved X into Y while B moved Y into X.
    const tree = resolveTree([
      folder({ id: 'x', name: 'X', parentId: 'y', createdAt: 100 }),
      folder({ id: 'y', name: 'Y', parentId: 'x', createdAt: 200 }),
      node({ id: 'f', name: 'f.js', parentId: 'y' }),
    ]);

    expect(paths(tree)).toEqual(['X', 'X/Y', 'X/Y/f.js']);
    expect(tree.conflicts).toEqual([{ nodeId: 'x', kind: 'cycle' }]);
  });

  it('breaks ties on createdAt by id', () => {
    const tree = resolveTree([
      folder({ id: 'b', name: 'B', parentId: 'a', createdAt: 100 }),
      folder({ id: 'a', name: 'A', parentId: 'b', createdAt: 100 }),
    ]);
    expect(paths(tree)).toEqual(['A', 'A/B']);
  });

  it('breaks a self-parented folder', () => {
    const tree = resolveTree([folder({ id: 'x', name: 'X', parentId: 'x' })]);
    expect(paths(tree)).toEqual(['X']);
    expect(tree.conflicts).toEqual([{ nodeId: 'x', kind: 'cycle' }]);
  });

  it('breaks a three-folder cycle and leaves a tail hanging off it intact', () => {
    const tree = resolveTree([
      folder({ id: 'a', name: 'A', parentId: 'c', createdAt: 300 }),
      folder({ id: 'b', name: 'B', parentId: 'a', createdAt: 100 }),
      folder({ id: 'c', name: 'C', parentId: 'b', createdAt: 200 }),
      folder({ id: 'tail', name: 'tail', parentId: 'a', createdAt: 50 }),
    ]);
    expect(paths(tree)).toEqual(['B', 'B/C', 'B/C/A', 'B/C/A/tail']);
  });

  it('breaks two independent cycles independently', () => {
    const tree = resolveTree([
      folder({ id: 'a1', name: 'A1', parentId: 'a2', createdAt: 1 }),
      folder({ id: 'a2', name: 'A2', parentId: 'a1', createdAt: 2 }),
      folder({ id: 'b1', name: 'B1', parentId: 'b2', createdAt: 4 }),
      folder({ id: 'b2', name: 'B2', parentId: 'b1', createdAt: 3 }),
    ]);
    expect(paths(tree)).toEqual(['A1', 'A1/A2', 'B2', 'B2/B1']);
  });

  it('hides a cycle whose members are deleted, after breaking it', () => {
    const tree = resolveTree([
      folder({ id: 'x', name: 'X', parentId: 'y', createdAt: 100 }),
      folder({ id: 'y', name: 'Y', parentId: 'x', createdAt: 200, deletedAt: 5 }),
    ]);
    expect(paths(tree)).toEqual(['X']);
    expect(tree.hidden.get('y')?.causeId).toBe('y');
  });

  it('does not report a cycle among hidden nodes', () => {
    const tree = resolveTree([
      folder({ id: 'x', name: 'X', parentId: 'y', createdAt: 100, deletedAt: 5 }),
      folder({ id: 'y', name: 'Y', parentId: 'x', createdAt: 200 }),
    ]);
    expect(tree.byId.size).toBe(0);
    expect(tree.conflicts).toEqual([]);
  });
});

describe('rule: duplicate names', () => {
  it('keeps the oldest name and suffixes the rest, identically for any input order', () => {
    const nodes = [
      folder({ id: 'src', name: 'src' }),
      node({ id: 'k3', name: 'utils.js', parentId: 'src', createdAt: 100 }),
      node({ id: 'a9', name: 'utils.js', parentId: 'src', createdAt: 105 }),
    ];
    const tree = resolveTree(nodes);

    expect(tree.byId.get('k3')?.displayName).toBe('utils.js');
    expect(tree.byId.get('a9')).toMatchObject({
      name: 'utils.js',
      displayName: 'utils (2).js',
      path: 'src/utils (2).js',
    });
    expect(tree.idByPath.get('src/utils (2).js')).toBe('a9');
    expect(tree.conflicts).toEqual([{ nodeId: 'a9', kind: 'duplicate-name' }]);
    expect(snapshot(resolveTree([...nodes].reverse()))).toEqual(snapshot(tree));
  });

  it('skips a suffix that a sibling really has as its name', () => {
    const tree = resolveTree([
      node({ id: 'one', name: 'utils.js', createdAt: 1 }),
      node({ id: 'two', name: 'utils.js', createdAt: 2 }),
      node({ id: 'real', name: 'utils (2).js', createdAt: 3 }),
    ]);

    expect(tree.byId.get('real')?.displayName).toBe('utils (2).js');
    expect(tree.byId.get('two')?.displayName).toBe('utils (3).js');
    expect(tree.idByPath.size).toBe(3);
  });

  it('numbers three copies in age order, tie broken by id', () => {
    const tree = resolveTree([
      node({ id: 'c', name: 'a.js', createdAt: 1 }),
      node({ id: 'b', name: 'a.js', createdAt: 1 }),
      node({ id: 'a', name: 'a.js', createdAt: 2 }),
    ]);
    expect(tree.byId.get('b')?.displayName).toBe('a.js');
    expect(tree.byId.get('c')?.displayName).toBe('a (2).js');
    expect(tree.byId.get('a')?.displayName).toBe('a (3).js');
  });

  it('treats a file and a folder with the same name as duplicates', () => {
    const tree = resolveTree([
      folder({ id: 'dir', name: 'utils', createdAt: 1 }),
      node({ id: 'file', name: 'utils', createdAt: 2 }),
    ]);
    expect(tree.byId.get('file')?.displayName).toBe('utils (2)');
  });

  it('is case-sensitive, like the WebContainer file system', () => {
    const tree = resolveTree([
      node({ id: 'lower', name: 'index.js' }),
      node({ id: 'upper', name: 'Index.js' }),
    ]);
    expect(tree.conflicts).toEqual([]);
  });

  it('ignores hidden siblings when looking for duplicates', () => {
    const tree = resolveTree([
      node({ id: 'old', name: 'utils.js', createdAt: 1, deletedAt: 10 }),
      node({ id: 'new', name: 'utils.js', createdAt: 2 }),
    ]);
    expect(tree.byId.get('new')?.displayName).toBe('utils.js');
  });

  it('only compares names within one folder', () => {
    const tree = resolveTree([
      folder({ id: 'a', name: 'a' }),
      folder({ id: 'b', name: 'b' }),
      node({ id: 'x', name: 'index.js', parentId: 'a' }),
      node({ id: 'y', name: 'index.js', parentId: 'b' }),
    ]);
    expect(tree.conflicts).toEqual([]);
  });

  it('suffixes a node that a cycle break or missing parent moved into a clash', () => {
    const tree = resolveTree([
      node({ id: 'root-file', name: 'a.js', createdAt: 1 }),
      node({ id: 'orphan', name: 'a.js', parentId: 'gone', createdAt: 2 }),
    ]);
    expect(tree.byId.get('orphan')?.displayName).toBe('a (2).js');
    expect(tree.conflicts).toEqual([
      { nodeId: 'orphan', kind: 'duplicate-name' },
      { nodeId: 'orphan', kind: 'missing-parent' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Convergence: two replicas edit the tree offline with arbitrary field writes
// (which can produce every anomaly above), exchange updates, and must resolve
// to exactly the same tree.
// ---------------------------------------------------------------------------

/** mulberry32: a tiny seeded generator so failures are reproducible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['a.js', 'b.js', 'utils.js', 'utils (2).js', 'src', 'lib'];

function randomEdits(doc: Y.Doc, random: () => number, label: string, count: number): void {
  const pick = <T>(items: readonly T[]): T | undefined =>
    items[Math.floor(random() * items.length)];
  const nodes = nodesMap(doc);

  for (let step = 0; step < count; step += 1) {
    const ids = [...nodes.keys()];
    const target = pick(ids);
    const roll = random();

    if (roll < 0.3 || !target) {
      const id = `${label}${String(step)}`;
      const fields = node({
        id,
        kind: random() < 0.4 ? 'folder' : 'file',
        name: pick(NAMES) ?? 'a.js',
        parentId: random() < 0.3 ? null : (pick(ids) ?? null),
        createdAt: Math.floor(random() * 5),
      });
      nodes.set(id, new Y.Map<NodeFieldValue>(Object.entries(fields)));
    } else if (roll < 0.6) {
      nodes.get(target)?.set('parentId', random() < 0.2 ? null : (pick(ids) ?? null));
    } else if (roll < 0.8) {
      nodes.get(target)?.set('name', pick(NAMES) ?? 'a.js');
    } else {
      nodes.get(target)?.set('deletedAt', random() < 0.5 ? null : 7);
    }
  }
}

function expectWellFormed(tree: ResolvedTree): void {
  expect(tree.idByPath.size).toBe(tree.byId.size);
  for (const resolved of tree.byId.values()) {
    expect(tree.hidden.has(resolved.id)).toBe(false);
    expect(tree.idByPath.get(resolved.path)).toBe(resolved.id);
    const parent = resolved.parentId === null ? null : tree.byId.get(resolved.parentId);
    if (resolved.parentId !== null) {
      expect(parent?.kind).toBe('folder');
      expect(resolved.path).toBe(`${parent?.path ?? ''}/${resolved.displayName}`);
    }
    expect(tree.childrenOf.get(resolved.parentId)).toContain(resolved.id);
  }
}

describe('convergence', () => {
  it.each(Array.from({ length: 200 }, (_, seed) => seed))(
    'seed %i: replicas resolve identically after exchanging offline edits',
    (seed) => {
      const random = seeded(seed);
      const alice = new Y.Doc();
      const bob = new Y.Doc();

      randomEdits(alice, random, 'shared', 6);
      Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

      randomEdits(alice, random, 'a', 12);
      randomEdits(bob, random, 'b', 12);
      Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
      Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));

      const fromAlice = resolveTree(readAllNodes(alice));
      const fromBob = resolveTree(readAllNodes(bob));
      expect(snapshot(fromAlice)).toEqual(snapshot(fromBob));
      expectWellFormed(fromAlice);

      const shuffled = [...readAllNodes(alice)].sort(() => random() - 0.5);
      expect(snapshot(resolveTree(shuffled))).toEqual(snapshot(fromAlice));

      alice.destroy();
      bob.destroy();
    },
  );
});

describe('the convergence generator', () => {
  it('actually produces every anomaly the rules exist for', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const random = seeded(seed);
      const alice = new Y.Doc();
      const bob = new Y.Doc();
      randomEdits(alice, random, 'shared', 6);
      Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
      randomEdits(alice, random, 'a', 12);
      randomEdits(bob, random, 'b', 12);
      Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));

      const tree = resolveTree(readAllNodes(alice));
      for (const conflict of tree.conflicts) seen.add(conflict.kind);
      for (const hidden of tree.hidden.values()) {
        if (hidden.causeId !== hidden.id) seen.add('cascade');
      }
      alice.destroy();
      bob.destroy();
    }
    expect([...seen].sort()).toEqual(['cascade', 'cycle', 'duplicate-name', 'missing-parent']);
  });
});
