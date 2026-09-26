import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  isInitialised,
  nodeNameSchema,
  nodesMap,
  readFileContent,
  readFileText,
  readMeta,
  readNode,
  readNodes,
  type NodeFieldValue,
} from './schema.js';
import { initProjectDoc } from './ops.js';
import { MAX_NAME_LENGTH } from './limits.js';

function newProject(): Y.Doc {
  const doc = new Y.Doc();
  initProjectDoc(doc, { name: 'Demo', template: 'blank-node', now: 1000 });
  return doc;
}

describe('nodeNameSchema', () => {
  it.each(['index.js', 'a', 'my file.js', '.env', 'Ünïcødé.js', 'a'.repeat(MAX_NAME_LENGTH)])(
    'accepts %j',
    (name) => {
      expect(nodeNameSchema.safeParse(name).success).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['slash', 'src/index.js'],
    ['backslash', 'src\\index.js'],
    ['dot', '.'],
    ['dot dot', '..'],
    ['leading space', ' index.js'],
    ['trailing space', 'index.js '],
    ['newline', 'index\n.js'],
    ['null byte', 'index\u0000.js'],
    ['too long', 'a'.repeat(MAX_NAME_LENGTH + 1)],
  ])('rejects %s', (_label, name) => {
    expect(nodeNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('readMeta', () => {
  it('reads metadata from an initialised document', () => {
    const doc = newProject();
    expect(readMeta(doc)).toEqual({
      schemaVersion: 1,
      name: 'Demo',
      template: 'blank-node',
      createdAt: 1000,
    });
    doc.destroy();
  });

  it('returns null for an empty document', () => {
    const doc = new Y.Doc();
    expect(readMeta(doc)).toBeNull();
    expect(isInitialised(doc)).toBe(false);
    doc.destroy();
  });
});

describe('readNode and readNodes', () => {
  it('returns null for an unknown id', () => {
    const doc = newProject();
    expect(readNode(doc, 'nope')).toBeNull();
    doc.destroy();
  });

  it('ignores a node another client wrote with a malformed shape', () => {
    const doc = newProject();
    const before = readNodes(doc).length;
    const junk = new Y.Map<NodeFieldValue>([
      ['id', 'junk'],
      ['kind', 'wormhole'],
    ]);
    nodesMap(doc).set('junk', junk);

    expect(readNode(doc, 'junk')).toBeNull();
    expect(readNodes(doc)).toHaveLength(before);
    doc.destroy();
  });

  it('leaves tombstoned nodes out of readNodes but keeps their content', () => {
    const doc = newProject();
    const [file] = readNodes(doc);
    nodesMap(doc).get(file!.id)?.set('deletedAt', 2000);

    expect(readNodes(doc)).toHaveLength(0);
    expect(readNode(doc, file!.id)?.deletedAt).toBe(2000);
    expect(readFileContent(doc, file!.id)).toContain('CollabCode');
    doc.destroy();
  });
});

describe('readFileText', () => {
  it('returns undefined when there is no content for an id', () => {
    const doc = newProject();
    expect(readFileText(doc, 'nope')).toBeUndefined();
    doc.destroy();
  });

  it('returns the live Y.Text, so edits are visible through it', () => {
    const doc = newProject();
    const [file] = readNodes(doc);
    const text = readFileText(doc, file!.id);
    text!.insert(0, 'x');
    expect(readFileContent(doc, file!.id)?.startsWith('x')).toBe(true);
    doc.destroy();
  });
});
