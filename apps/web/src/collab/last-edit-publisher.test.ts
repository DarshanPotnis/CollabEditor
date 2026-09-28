import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createLastEditPublisher, isLocalTextEdit } from './last-edit-publisher.js';

describe('createLastEditPublisher', () => {
  it('publishes the first edit at once, then at most every few seconds', () => {
    let now = 1_000;
    const published: number[] = [];
    const edited = createLastEditPublisher(
      (at) => published.push(at),
      () => now,
      5_000,
    );
    edited();
    now = 3_000;
    edited();
    now = 6_000;
    edited();
    now = 6_500;
    edited();
    expect(published).toEqual([1_000, 6_000]);
  });
});

describe('isLocalTextEdit', () => {
  it('counts text typed here, not map changes or edits that arrive from others', () => {
    const doc = new Y.Doc();
    const seen: boolean[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) =>
      seen.push(isLocalTextEdit(transaction)),
    );
    const text = doc.getMap<Y.Text>('contents').set('f1', new Y.Text());
    text.insert(0, 'typed');
    doc.getMap('nodes').set('n1', 'renamed');

    const other = new Y.Doc();
    other.getText('t').insert(0, 'theirs');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

    // Creating the file changes the map; typing into it is the edit.
    expect(seen).toEqual([false, true, false, false]);
  });
});
