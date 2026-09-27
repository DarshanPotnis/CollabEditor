import { describe, expect, it } from 'vitest';
import { resolveTree } from '@collabcode/shared';
import { node } from '../test/nodes.js';
import { cycleMessage, newCycles } from './cycle-notice.js';

const before = resolveTree([
  node({ id: 'x', name: 'X', kind: 'folder', createdAt: 1 }),
  node({ id: 'y', name: 'Y', kind: 'folder', createdAt: 2 }),
]);
const after = resolveTree([
  node({ id: 'x', name: 'X', kind: 'folder', parentId: 'y', createdAt: 1 }),
  node({ id: 'y', name: 'Y', kind: 'folder', parentId: 'x', createdAt: 2 }),
]);

describe('newCycles', () => {
  it('reports a cycle that just appeared, once', () => {
    expect(newCycles(before, after)).toEqual([{ nodeId: 'x', kind: 'cycle', others: ['y'] }]);
    expect(newCycles(after, after)).toEqual([]);
  });

  it('stays quiet when the project first loads with a cycle already in it', () => {
    expect(newCycles(resolveTree([]), after)).toEqual([]);
  });
});

describe('cycleMessage', () => {
  it('names both folders and says which one moved', () => {
    const [cycle] = newCycles(before, after);
    expect(cycleMessage(after, cycle!)).toBe(
      '“X” and “Y” were moved into each other at the same time, so “X” was kept at the top level. Nothing was lost.',
    );
  });
});
