import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { remoteCursorIndex } from './remote-selection.js';

/** A selection as another client would publish it, after a trip through JSON. */
function remoteSelection(ytext: Y.Text, anchor: number, head: number): unknown {
  const state = {
    user: { name: 'Ada' },
    selection: {
      anchor: Y.createRelativePositionFromTypeIndex(ytext, anchor),
      head: Y.createRelativePositionFromTypeIndex(ytext, head),
    },
  };
  return JSON.parse(JSON.stringify(state)) as unknown;
}

function twoFiles(): { doc: Y.Doc; a: Y.Text; b: Y.Text } {
  const doc = new Y.Doc();
  const contents = doc.getMap<Y.Text>('contents');
  contents.set('a', new Y.Text('hello world'));
  contents.set('b', new Y.Text('other file'));
  const a = contents.get('a');
  const b = contents.get('b');
  if (!a || !b) throw new Error('fixture');
  return { doc, a, b };
}

describe('remoteCursorIndex', () => {
  it('finds the head of a selection sent over awareness', () => {
    const { a } = twoFiles();
    expect(remoteCursorIndex(remoteSelection(a, 0, 5), a)).toBe(5);
  });

  it('follows the text as it changes, since positions are relative', () => {
    const { a } = twoFiles();
    const state = remoteSelection(a, 6, 6);
    a.insert(0, '>>> ');
    expect(remoteCursorIndex(state, a)).toBe(10);
  });

  it('returns null when the cursor is in another file', () => {
    const { a, b } = twoFiles();
    expect(remoteCursorIndex(remoteSelection(b, 2, 2), a)).toBeNull();
  });

  it.each([
    ['no state', undefined],
    ['no selection', { user: {} }],
    ['a null selection', { selection: null }],
    ['a string head', { selection: { anchor: {}, head: 'x' } }],
    ['a negative clock', { selection: { anchor: {}, head: { item: { client: 1, clock: -1 } } } }],
    [
      'an unsafe integer',
      { selection: { anchor: {}, head: { item: { client: 2 ** 60, clock: 0 } } } },
    ],
    [
      'a root type name, which would create a root type',
      { selection: { anchor: {}, head: { tname: 'nodes' } } },
    ],
    ['an empty head, which makes Yjs throw', { selection: { anchor: {}, head: {} } }],
  ])('returns null for %s', (_label, state) => {
    const { a } = twoFiles();
    expect(remoteCursorIndex(state, a)).toBeNull();
  });

  it('never adds a root type to the document, whatever it is sent', () => {
    const { doc, a } = twoFiles();
    const before = [...doc.share.keys()];
    remoteCursorIndex({ selection: { anchor: {}, head: { tname: 'intruder' } } }, a);
    expect([...doc.share.keys()]).toEqual(before);
  });

  it('finds the end of an empty file, which is addressed by its type', () => {
    const doc = new Y.Doc();
    const contents = doc.getMap<Y.Text>('contents');
    contents.set('empty', new Y.Text());
    const empty = contents.get('empty');
    if (!empty) throw new Error('fixture');
    expect(remoteCursorIndex(remoteSelection(empty, 0, 0), empty)).toBe(0);
  });

  it('returns null for a well-formed position the document does not contain', () => {
    const { a } = twoFiles();
    const state = {
      selection: { anchor: {}, head: { item: { client: 424242, clock: 7 }, assoc: 0 } },
    };
    expect(remoteCursorIndex(state, a)).toBeNull();
  });
});
