import { createFakeClock, someoneElseEditing } from '@collabcode/agent';
import { createProjectUpdate, readFileContent, resolveDocTree } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  COLLABORATOR_MARK,
  COLLABORATOR_ORIGIN,
  startSimulatedCollaborator,
} from './simulated-collaborator.js';

describe('the simulated collaborator', () => {
  it('keeps a file busy for the presence rule, typing there with its own origin', async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, createProjectUpdate({ name: 'Eval', template: 'express-api' }).update);
    const tree = resolveDocTree(doc);
    const fileId = tree.idByPath.get('index.js') ?? '';
    const origins = new Set<unknown>();
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.add(transaction.origin));
    const clock = createFakeClock(1_000_000);
    const collaborator = startSimulatedCollaborator({ doc, tree, path: 'index.js', clock });
    const presence = { hostUserId: 'host', selfClientId: 1, peers: () => [collaborator.peer()] };

    expect(someoneElseEditing(presence, fileId, clock.now())).toBe(true);
    // Long after the presence window, it still counts, because it keeps typing.
    for (let tick = 0; tick < 30; tick += 1) {
      clock.advance(2_000);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(someoneElseEditing(presence, fileId, clock.now())).toBe(true);
    expect(readFileContent(doc, fileId)).toMatch(new RegExp(`${COLLABORATOR_MARK}\\.{30}$`));
    expect([...origins]).toEqual([COLLABORATOR_ORIGIN]);

    collaborator.stop();
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(60_000);
    expect(someoneElseEditing(presence, fileId, clock.now())).toBe(false);
  });
});
