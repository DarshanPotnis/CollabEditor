import { describe, expect, it } from 'vitest';
import { resolveTree } from '@collabcode/shared';
import { node } from '../test/nodes.js';
import type { Collaborator } from './collaborators.js';
import { followLabel, followTarget } from './follow.js';

const tree = resolveTree([
  node({ id: 'src', name: 'src', kind: 'folder' }),
  node({ id: 'live', name: 'app.js', parentId: 'src' }),
  node({ id: 'dead', name: 'old.js', deletedAt: 5 }),
]);

function ada(activeFileId: string | null): Collaborator {
  return {
    clientId: 7,
    activeFileId,
    isYou: false,
    user: { id: 'ada', name: 'Ada', color: '#2563eb', kind: 'human' },
  };
}

describe('followTarget', () => {
  it('opens the file they are in, including a deleted one', () => {
    expect(followTarget(ada('live'), tree)).toEqual({
      kind: 'file',
      fileId: 'live',
      name: 'src/app.js',
    });
    expect(followTarget(ada('dead'), tree)).toEqual({
      kind: 'file',
      fileId: 'dead',
      name: 'old.js (deleted)',
    });
  });

  it('explains when there is nothing to open', () => {
    expect(followTarget(ada(null), tree)).toEqual({
      kind: 'nowhere',
      message: "Ada doesn't have a file open.",
    });
    expect(followTarget(ada('purged'), tree)).toMatchObject({ kind: 'nowhere' });
    expect(followTarget(ada('src'), tree)).toMatchObject({ kind: 'nowhere' });
  });
});

describe('followLabel', () => {
  it('says where clicking goes', () => {
    expect(followLabel(ada('live'), tree)).toBe('Ada, in src/app.js. Go to their cursor');
    expect(followLabel(ada(null), tree)).toBe('Ada, no file open');
  });
});
