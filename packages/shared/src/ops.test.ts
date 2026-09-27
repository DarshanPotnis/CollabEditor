import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { OPS_ORIGIN, OpError, createProjectUpdate, initProjectDoc } from './ops.js';
import { isInitialised, readFileContent, readMeta, readNodes } from './schema.js';
import { TEMPLATES, TEMPLATE_IDS } from './templates/index.js';

describe('initProjectDoc', () => {
  it('creates meta, one node per template file, and its content', () => {
    const doc = new Y.Doc();
    const result = initProjectDoc(doc, {
      name: 'My API',
      template: 'express-api',
      createdBy: 'user-1',
      now: 1700000000000,
    });

    expect(isInitialised(doc)).toBe(true);
    expect(readMeta(doc)).toEqual({
      schemaVersion: 1,
      name: 'My API',
      template: 'express-api',
      createdAt: 1700000000000,
    });

    const nodes = readNodes(doc);
    expect(nodes).toHaveLength(TEMPLATES['express-api'].files.length);
    expect(nodes[0]).toMatchObject({
      kind: 'file',
      name: 'index.js',
      parentId: null,
      createdAt: 1700000000000,
      createdBy: 'user-1',
      deletedAt: null,
    });
    expect(result.entryFileId).toBe(nodes[0]!.id);
    expect(readFileContent(doc, result.entryFileId)).toBe(
      TEMPLATES['express-api'].files[0].content,
    );
    doc.destroy();
  });

  it.each(TEMPLATE_IDS)('builds a usable document from the %s template', (template) => {
    const doc = new Y.Doc();
    const { entryFileId, fileIds } = initProjectDoc(doc, { name: 'T', template });
    expect(fileIds).toContain(entryFileId);
    expect(readFileContent(doc, entryFileId)?.length).toBeGreaterThan(0);
    doc.destroy();
  });

  it('defaults createdBy to system and createdAt to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const doc = new Y.Doc();
    initProjectDoc(doc, { name: 'T', template: 'blank-node' });
    expect(readNodes(doc)[0]).toMatchObject({
      createdBy: 'system',
      createdAt: Date.parse('2026-01-01T00:00:00Z'),
    });
    vi.useRealTimers();
    doc.destroy();
  });

  it('writes everything in a single transaction tagged with the ops origin', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));

    initProjectDoc(doc, { name: 'T', template: 'blank-node' });

    expect(origins).toEqual([OPS_ORIGIN]);
    doc.destroy();
  });

  it('refuses to initialise a document twice', () => {
    const doc = new Y.Doc();
    initProjectDoc(doc, { name: 'T', template: 'blank-node' });

    const second = () => initProjectDoc(doc, { name: 'T', template: 'blank-node' });
    expect(second).toThrow(OpError);
    expect(second).toThrow(/already/i);
    expect(readNodes(doc)).toHaveLength(1);
    doc.destroy();
  });

  it('rejects an invalid project name before touching the document', () => {
    const doc = new Y.Doc();
    expect(() => initProjectDoc(doc, { name: '', template: 'blank-node' })).toThrow(OpError);
    expect(isInitialised(doc)).toBe(false);
    doc.destroy();
  });

  it('gives every node a distinct id', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const doc = new Y.Doc();
      const { entryFileId } = initProjectDoc(doc, { name: 'T', template: 'blank-node' });
      ids.add(entryFileId);
      doc.destroy();
    }
    expect(ids.size).toBe(50);
  });
});

describe('createProjectUpdate', () => {
  it('produces an update that restores the same document', () => {
    const { update, entryFileId } = createProjectUpdate({
      name: 'Round trip',
      template: 'express-api',
      now: 42,
    });

    const restored = new Y.Doc();
    Y.applyUpdate(restored, update);

    expect(readMeta(restored)).toEqual({
      schemaVersion: 1,
      name: 'Round trip',
      template: 'express-api',
      createdAt: 42,
    });
    expect(readFileContent(restored, entryFileId)).toBe(TEMPLATES['express-api'].files[0].content);
    restored.destroy();
  });
});
