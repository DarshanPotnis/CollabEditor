import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { resolveTree } from '@collabcode/shared';
import { node } from '../../test/nodes.js';
import { editorSpecs } from './editor-specs.js';

const doc = new Y.Doc();
const texts = new Map(['live', 'dead', 'purged'].map((id) => [id, doc.getText(id)]));
const textFor = (id: string): Y.Text | undefined => (id === 'purged' ? undefined : texts.get(id));

const tree = resolveTree([
  node({ id: 'src', name: 'src', kind: 'folder' }),
  node({ id: 'live', name: 'app.ts', parentId: 'src' }),
  node({ id: 'dead', name: 'old.js', deletedAt: 5 }),
]);
const tabs = ['live', 'dead', 'purged'].map((id) => ({ id, lastName: id }));

describe('editorSpecs', () => {
  it('opens live files at their path, editable, in their language', () => {
    const spec = editorSpecs(tabs, tree, textFor).get('live');
    expect(spec?.uri.toString()).toBe('file:///src/app.ts');
    expect(spec).toMatchObject({ path: 'src/app.ts', language: 'typescript', readOnly: false });
  });

  it('keeps a deleted file open read-only under its own URI', () => {
    const spec = editorSpecs(tabs, tree, textFor).get('dead');
    expect(spec?.uri.scheme).toBe('collabcode-deleted');
    expect(spec).toMatchObject({ path: 'old.js', language: 'javascript', readOnly: true });
  });

  it('gives a permanently deleted file no model', () => {
    expect(editorSpecs(tabs, tree, textFor).has('purged')).toBe(false);
  });
});
