import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MAX_FILE_SIZE } from './limits.js';
import { OpError, type OpErrorCode } from './op-error.js';
import { readFileContent } from './schema.js';
import { deleteText, insertText, planReplacement, replaceText } from './text-ops.js';
import { createFile } from './tree-ops.js';

const alice = { userId: 'alice', userName: 'Alice', now: 1_000 };
const AGENT = 'collabcode:agent:test';

function fileWith(content: string): { doc: Y.Doc; fileId: string } {
  const doc = new Y.Doc();
  const fileId = createFile(doc, { parentId: null, name: 'a.js', content }, alice);
  return { doc, fileId };
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

function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

describe('planReplacement', () => {
  it('changes only the characters that differ', () => {
    const content = 'const a = 1;\nconst b = 2;\n';
    expect(planReplacement(content, 'const b = 2;', 'const b = 3;')).toEqual({
      index: content.indexOf('2'),
      deleteCount: 1,
      insert: '3',
    });
  });

  it('describes a pure insertion and a pure deletion', () => {
    expect(planReplacement('ab', 'ab', 'aXb')).toEqual({ index: 1, deleteCount: 0, insert: 'X' });
    expect(planReplacement('aXb', 'aXb', 'ab')).toEqual({ index: 1, deleteCount: 1, insert: '' });
  });

  it('does not count shared characters twice when the texts repeat', () => {
    // "aa" -> "aaa": the prefix and suffix overlap unless capped.
    expect(planReplacement('xaay', 'aa', 'aaa')).toEqual({ index: 3, deleteCount: 0, insert: 'a' });
  });

  it('refuses text that is not there, and says it may have changed', () => {
    expectOpError(() => planReplacement('abc', 'xyz', 'q'), 'no-match', /may have changed/);
  });

  it('refuses text that occurs more than once, counting overlaps', () => {
    expectOpError(() => planReplacement('ab ab ab', 'ab', 'x'), 'ambiguous-match', /3 times/);
    expectOpError(() => planReplacement('aaa', 'aa', 'b'), 'ambiguous-match', /2 times/);
  });

  it('allows empty text to replace only in an empty file', () => {
    expect(planReplacement('', '', 'hello')).toEqual({ index: 0, deleteCount: 0, insert: 'hello' });
    expectOpError(() => planReplacement('x', '', 'hello'), 'no-match', /only be empty/);
  });

  it('never splits a surrogate pair', () => {
    // 😀 and 😁 share their high surrogate; splitting there would corrupt both.
    const change = planReplacement('say 😀!', '😀', '😁');
    expect(change).toEqual({ index: 4, deleteCount: 2, insert: '😁' });
    // Same low surrogate, different high one: the suffix must not start inside the pair.
    const low = planReplacement('😀', '😀', '🨀');
    expect(low).toEqual({ index: 0, deleteCount: 2, insert: '🨀' });
  });

  it('refuses growing a file past the limit, but always allows shrinking it', () => {
    const nearlyFull = `${'x'.repeat(MAX_FILE_SIZE - 1)}!`;
    expectOpError(() => planReplacement(nearlyFull, '!', '!!'), 'file-too-large', /512 KB/);
    const over = `${'x'.repeat(MAX_FILE_SIZE + 10)}!`;
    expect(planReplacement(over, 'x!', '!').deleteCount).toBe(1);
  });
});

describe('replaceText', () => {
  it('applies the change in one transaction tagged with the origin', () => {
    const { doc, fileId } = fileWith('let x = 1;\n');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));

    const change = replaceText(doc, fileId, 'x = 1', 'x = 42', AGENT);

    expect(readFileContent(doc, fileId)).toBe('let x = 42;\n');
    expect(change).toEqual({ index: 8, deleteCount: 1, insert: '42' });
    expect(origins).toEqual([AGENT]);
  });

  it('writes nothing when the text is unchanged', () => {
    const { doc, fileId } = fileWith('same');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    replaceText(doc, fileId, 'same', 'same', AGENT);
    expect(origins).toEqual([]);
  });

  it('writes nothing when refused', () => {
    const { doc, fileId } = fileWith('a a');
    expectOpError(() => replaceText(doc, fileId, 'a', 'b', AGENT), 'ambiguous-match');
    expect(readFileContent(doc, fileId)).toBe('a a');
  });

  it('refuses a file that does not exist', () => {
    expectOpError(() => replaceText(new Y.Doc(), 'missing', 'a', 'b', AGENT), 'not-found');
  });

  it("keeps a collaborator's concurrent typing inside the unchanged part of the edit", () => {
    const { doc: agent, fileId } = fileWith('function greet() {\n  return "hi";\n}\n');
    const human = new Y.Doc();
    sync(agent, human);

    // The human adds a parameter while the agent changes the return value.
    human.getMap<Y.Text>('contents').get(fileId)?.insert('function greet('.length, 'name');
    replaceText(
      agent,
      fileId,
      'function greet() {\n  return "hi";',
      'function greet() {\n  return "hello";',
      AGENT,
    );
    sync(agent, human);
    sync(human, agent);

    const expected = 'function greet(name) {\n  return "hello";\n}\n';
    expect(readFileContent(agent, fileId)).toBe(expected);
    expect(readFileContent(human, fileId)).toBe(expected);
  });
});

describe('insertText and deleteText', () => {
  it('write in one transaction each, with the origin', () => {
    const { doc, fileId } = fileWith('hello world');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    deleteText(doc, fileId, 5, 6, AGENT);
    insertText(doc, fileId, 5, ', there', AGENT);
    expect(readFileContent(doc, fileId)).toBe('hello, there');
    expect(origins).toEqual([AGENT, AGENT]);
  });

  it('refuses an insert past the per-file limit, checked again for each piece', () => {
    const { doc, fileId } = fileWith('x'.repeat(MAX_FILE_SIZE - 2));
    insertText(doc, fileId, 0, 'ab', AGENT);
    expectOpError(
      () => insertText(doc, fileId, 0, 'c', AGENT),
      'file-too-large',
      /part way through/,
    );
  });

  it('refuses a file that does not exist', () => {
    expectOpError(() => insertText(new Y.Doc(), 'missing', 0, 'a', AGENT), 'not-found');
  });
});
