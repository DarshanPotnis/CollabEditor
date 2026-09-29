import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAgentUndo } from './agent-undo.js';
import { agentOrigin } from './op-error.js';
import { readFileContent, readFileText, readNode } from './schema.js';
import { replaceText } from './text-ops.js';
import { createFile, createFolder, move, rename, resolveDocTree, softDelete } from './tree-ops.js';

const AGENT = agentOrigin('session-1');
const agent = { userId: 'agent-session-1', userName: 'AI teammate', now: 5_000 };
const alice = { userId: 'alice', userName: 'Alice', now: 1_000 };

/** Deliver what one replica has that the other lacks, as a remote update. */
function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

function exchange(a: Y.Doc, b: Y.Doc): void {
  sync(a, b);
  sync(b, a);
}

function text(doc: Y.Doc, fileId: string): Y.Text {
  const found = readFileText(doc, fileId);
  if (!found) throw new Error(`no text for ${fileId}`);
  return found;
}

/** Alice's project, and the agent's replica of it (a separate CRDT peer). */
function setup() {
  const human = new Y.Doc();
  const routes = createFolder(human, { parentId: null, name: 'routes' }, alice);
  const users = createFile(
    human,
    { parentId: routes, name: 'users.js', content: 'const users = [];\n' },
    alice,
  );
  const index = createFile(
    human,
    { parentId: null, name: 'index.js', content: 'app.listen(3000);\n' },
    alice,
  );
  const agentDoc = new Y.Doc();
  exchange(human, agentDoc);
  const undo = createAgentUndo(agentDoc, AGENT);
  return { human, agentDoc, undo, routes, users, index };
}

describe('text edits', () => {
  it("reverts the agent's edits and keeps what a person typed, even inside them", () => {
    const { human, agentDoc, undo, users } = setup();
    undo.trackEdit(users);
    replaceText(
      agentDoc,
      users,
      'const users = [];',
      'const users = [];\nexport function remove(id) {\n  return id;\n}',
      AGENT,
    );
    exchange(agentDoc, human);

    text(human, users).insert(0, '// users\n');
    const insideAgentText = (readFileContent(human, users) ?? '').indexOf('return id;') + 10;
    text(human, users).insert(insideAgentText, ' // mine');
    exchange(human, agentDoc);

    const result = undo.undo(agent);
    exchange(agentDoc, human);

    const expected = '// users\nconst users = []; // mine\n';
    expect(readFileContent(agentDoc, users)).toBe(expected);
    expect(readFileContent(human, users)).toBe(expected);
    expect(result).toEqual({ textFiles: 1, treeActions: 0, skipped: [] });
  });

  it('leaves files the agent never touched alone', () => {
    const { human, agentDoc, undo, users, index } = setup();
    undo.trackEdit(users);
    replaceText(agentDoc, users, '[]', '[1]', AGENT);
    text(human, index).insert(0, '// alice\n');
    exchange(human, agentDoc);

    undo.undo(agent);

    expect(readFileContent(agentDoc, index)).toBe('// alice\napp.listen(3000);\n');
    expect(readFileContent(agentDoc, users)).toBe('const users = [];\n');
  });
});

describe('tree actions', () => {
  it('soft-deletes a file the agent created, keeping what a person typed in it', () => {
    const { human, agentDoc, undo, routes } = setup();
    const admin = createFile(
      agentDoc,
      { parentId: routes, name: 'admin.js', content: 'export {};\n' },
      agent,
      AGENT,
    );
    undo.recordTreeAction({ kind: 'created', nodeId: admin });
    exchange(agentDoc, human);
    text(human, admin).insert(0, '// keep me\n');
    exchange(human, agentDoc);

    const result = undo.undo(agent);

    expect(readNode(agentDoc, admin)).toMatchObject({ deletedAt: 5_000, deletedBy: agent.userId });
    expect(readFileContent(agentDoc, admin)).toBe('// keep me\nexport {};\n');
    expect(result.treeActions).toBe(1);
  });

  it('moves and renames a node back', () => {
    const { agentDoc, undo, routes, index } = setup();
    rename(agentDoc, index, 'server.js', AGENT);
    move(agentDoc, index, routes, AGENT);
    undo.recordTreeAction({
      kind: 'moved',
      nodeId: index,
      from: { parentId: null, name: 'index.js' },
      to: { parentId: routes, name: 'server.js' },
    });

    undo.undo(agent);

    expect(readNode(agentDoc, index)).toMatchObject({ parentId: null, name: 'index.js' });
  });

  it('leaves a rename alone when someone renamed the node again since', () => {
    const { human, agentDoc, undo, index } = setup();
    rename(agentDoc, index, 'server.js', AGENT);
    undo.recordTreeAction({
      kind: 'moved',
      nodeId: index,
      from: { parentId: null, name: 'index.js' },
      to: { parentId: null, name: 'server.js' },
    });
    exchange(agentDoc, human);
    rename(human, index, 'main.js');
    exchange(human, agentDoc);

    const result = undo.undo(agent);

    expect(readNode(agentDoc, index)?.name).toBe('main.js');
    expect(result.skipped).toEqual([
      { nodeId: index, reason: 'Someone moved or renamed it since.' },
    ]);
  });

  it('restores a file the agent deleted', () => {
    const { agentDoc, undo, users } = setup();
    softDelete(agentDoc, users, agent, AGENT);
    undo.recordTreeAction({ kind: 'deleted', nodeId: users });

    undo.undo(agent);

    expect(readNode(agentDoc, users)?.deletedAt).toBeNull();
  });

  it('does not restore a file whose folder someone else deleted since', () => {
    const { human, agentDoc, undo, routes, users } = setup();
    softDelete(agentDoc, users, agent, AGENT);
    undo.recordTreeAction({ kind: 'deleted', nodeId: users });
    exchange(agentDoc, human);
    softDelete(human, routes, alice);
    exchange(human, agentDoc);

    const result = undo.undo(agent);

    expect(readNode(agentDoc, users)?.deletedAt).not.toBeNull();
    expect(readNode(agentDoc, routes)?.deletedBy).toBe('alice');
    expect(result.skipped[0]?.reason).toMatch(/folder has been deleted/);
  });

  it('keeps a folder the agent created when someone else added a file to it', () => {
    const { human, agentDoc, undo } = setup();
    const lib = createFolder(agentDoc, { parentId: null, name: 'lib' }, agent, AGENT);
    undo.recordTreeAction({ kind: 'created', nodeId: lib });
    const helper = createFile(agentDoc, { parentId: lib, name: 'a.js' }, agent, AGENT);
    undo.recordTreeAction({ kind: 'created', nodeId: helper });
    exchange(agentDoc, human);
    createFile(human, { parentId: lib, name: 'b.js' }, alice);
    exchange(human, agentDoc);

    const result = undo.undo(agent);

    const paths = [...resolveDocTree(agentDoc).byId.values()].map((node) => node.path);
    expect(paths).toContain('lib/b.js');
    expect(paths).not.toContain('lib/a.js');
    expect(result.skipped).toEqual([
      { nodeId: lib, reason: 'Kept the folder "lib" because it has files someone else added.' },
    ]);
  });

  it('removes a folder that holds only what the agent created', () => {
    const { agentDoc, undo } = setup();
    const lib = createFolder(agentDoc, { parentId: null, name: 'lib' }, agent, AGENT);
    undo.recordTreeAction({ kind: 'created', nodeId: lib });
    const helper = createFile(agentDoc, { parentId: lib, name: 'a.js' }, agent, AGENT);
    undo.recordTreeAction({ kind: 'created', nodeId: helper });

    expect(undo.undo(agent)).toEqual({ textFiles: 0, treeActions: 2, skipped: [] });
    expect(resolveDocTree(agentDoc).byId.has(lib)).toBe(false);
  });
});

describe('preview', () => {
  it('is empty until the agent writes something', () => {
    const { agentDoc, undo, users } = setup();
    expect(undo.preview()).toEqual({ empty: true, changedByOthers: [] });
    undo.trackEdit(users);
    expect(undo.preview().empty).toBe(true);
    replaceText(agentDoc, users, '[]', '[1]', AGENT);
    expect(undo.preview()).toEqual({ empty: false, changedByOthers: [] });
  });

  it('lists the files someone else changed after the agent touched them, once each', () => {
    const { human, agentDoc, undo, users, index } = setup();
    undo.trackEdit(users);
    replaceText(agentDoc, users, '[]', '[1]', AGENT);
    rename(agentDoc, index, 'server.js', AGENT);
    undo.recordTreeAction({
      kind: 'moved',
      nodeId: index,
      from: { parentId: null, name: 'index.js' },
      to: { parentId: null, name: 'server.js' },
    });
    exchange(agentDoc, human);

    text(human, users).insert(0, 'a');
    text(human, users).insert(0, 'b');
    rename(human, index, 'main.js');
    exchange(human, agentDoc);

    expect(undo.preview().changedByOthers.toSorted()).toEqual([users, index].toSorted());
  });

  it('is empty again after an undo, and a second undo does nothing', () => {
    const { agentDoc, undo, users } = setup();
    undo.trackEdit(users);
    replaceText(agentDoc, users, '[]', '[1]', AGENT);
    undo.undo(agent);

    expect(undo.preview().empty).toBe(true);
    expect(undo.undo(agent)).toEqual({ textFiles: 0, treeActions: 0, skipped: [] });
    expect(readFileContent(agentDoc, users)).toBe('const users = [];\n');
  });
});
