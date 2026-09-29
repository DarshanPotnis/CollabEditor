import { createProjectUpdate, resolveDocTree } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { lookupPath, nearPaths, normalizePath, placementOf } from './paths.js';

function tree() {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, createProjectUpdate({ name: 'Demo', template: 'express-api' }).update);
  return resolveDocTree(doc);
}

describe('normalizePath', () => {
  it.each([
    ['routes/users.js', 'routes/users.js'],
    ['./routes/users.js', 'routes/users.js'],
    ['/routes//users.js/', 'routes/users.js'],
    ['routes\\users.js', 'routes/users.js'],
    ['  index.js ', 'index.js'],
  ])('reads %j as %j', (raw, path) => {
    expect(normalizePath(raw)).toEqual({ ok: true, path });
  });

  it.each(['../x', 'routes/../../x', '', '/', './'])('refuses %j', (raw) => {
    expect(normalizePath(raw).ok).toBe(false);
  });
});

describe('lookupPath and nearPaths', () => {
  it('finds a visible node by its display path', () => {
    const found = lookupPath(tree(), 'routes/users.js');
    expect(found.ok && found.node.name).toBe('users.js');
  });

  it('suggests a different case, the same file name, or a small typo', () => {
    const resolved = tree();
    expect(nearPaths(resolved, 'ROUTES/USERS.JS')[0]).toBe('routes/users.js');
    expect(nearPaths(resolved, 'src/users.js')).toContain('routes/users.js');
    expect(nearPaths(resolved, 'indx.js')).toContain('index.js');
    expect(nearPaths(resolved, 'completely/unrelated/thing.ts')).toEqual([]);
  });
});

describe('placementOf', () => {
  it('splits a path into its folder and name', () => {
    expect(placementOf('a/b/c.js')).toEqual({ parentPath: 'a/b', name: 'c.js' });
    expect(placementOf('c.js')).toEqual({ parentPath: null, name: 'c.js' });
  });
});
