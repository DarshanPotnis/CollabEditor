import { MAX_FILE_SIZE } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CHANGED_MESSAGE, anchorSelection, planAnchoredEdit } from './selection-anchor.js';

const FILE = 'const a = 1;\nlet b = 2;\nconst c = 3;\n';
const SELECTED = 'let b = 2;';

/** Two peers editing one file, kept in sync like two browsers. */
function twoPeers(initial: string): { mine: Y.Text; theirs: Y.Text } {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  docA.on('update', (update: Uint8Array) => Y.applyUpdate(docB, update));
  docB.on('update', (update: Uint8Array) => Y.applyUpdate(docA, update));
  const mine = docA.getText('file');
  mine.insert(0, initial);
  return { mine, theirs: docB.getText('file') };
}

function anchorSelected(ytext: Y.Text): ReturnType<typeof anchorSelection> {
  const start = ytext.toJSON().indexOf(SELECTED);
  return anchorSelection(ytext, start, start + SELECTED.length);
}

function apply(ytext: Y.Text, plan: ReturnType<typeof planAnchoredEdit>): void {
  if (!plan.ok) throw new Error(plan.message);
  ytext.delete(plan.start, plan.end - plan.start);
  ytext.insert(plan.start, plan.text);
}

describe('anchorSelection and planAnchoredEdit', () => {
  it('finds the selection again after a collaborator edits elsewhere', () => {
    const { mine, theirs } = twoPeers(FILE);
    const anchor = anchorSelected(mine);
    theirs.insert(0, '// header\n');
    theirs.insert(theirs.length, '// footer\n');

    const plan = planAnchoredEdit(mine, anchor, 'const b = 2;');
    apply(mine, plan);
    expect(mine.toJSON()).toBe('// header\nconst a = 1;\nconst b = 2;\nconst c = 3;\n// footer\n');
  });

  it('refuses when a collaborator changed the selected code', () => {
    const { mine, theirs } = twoPeers(FILE);
    const anchor = anchorSelected(mine);
    theirs.insert(theirs.toJSON().indexOf('2;'), '4');

    expect(planAnchoredEdit(mine, anchor, 'const b = 2;')).toEqual({
      ok: false,
      reason: 'changed',
      message: CHANGED_MESSAGE,
    });
  });

  it('refuses when the selected code was deleted', () => {
    const { mine, theirs } = twoPeers(FILE);
    const anchor = anchorSelected(mine);
    theirs.delete(theirs.toJSON().indexOf(SELECTED), SELECTED.length + 1);
    expect(planAnchoredEdit(mine, anchor, 'x')).toMatchObject({ ok: false, reason: 'changed' });
  });

  it('keeps text typed right against either end outside the range, and applies', () => {
    const { mine, theirs } = twoPeers(FILE);
    const anchor = anchorSelected(mine);
    const at = theirs.toJSON().indexOf(SELECTED);
    theirs.insert(at + SELECTED.length, ' // end');
    theirs.insert(at, '/* start */ ');

    apply(mine, planAnchoredEdit(mine, anchor, 'const b = 2;'));
    expect(mine.toJSON()).toBe('const a = 1;\n/* start */ const b = 2; // end\nconst c = 3;\n');
  });

  it('refuses a replacement that would take the file past its size limit', () => {
    const { mine } = twoPeers(FILE);
    const anchor = anchorSelected(mine);
    expect(planAnchoredEdit(mine, anchor, 'x'.repeat(MAX_FILE_SIZE))).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
  });

  it('remembers the text that was selected', () => {
    const { mine } = twoPeers(FILE);
    expect(anchorSelected(mine).original).toBe(SELECTED);
  });
});
