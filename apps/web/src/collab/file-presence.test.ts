import { describe, expect, it } from 'vitest';
import type { Collaborator } from './collaborators.js';
import { filePresence, samePresence } from './file-presence.js';

function person(clientId: number, activeFileId: string | null, isYou = false): Collaborator {
  return {
    clientId,
    activeFileId,
    isYou,
    user: {
      id: `u${String(clientId)}`,
      name: `P${String(clientId)}`,
      color: '#2563eb',
      kind: 'human',
    },
    agent: null,
  };
}

describe('filePresence', () => {
  it('groups other people by open file and leaves you and idle people out', () => {
    const presence = filePresence([
      person(1, 'a', true),
      person(2, 'a'),
      person(3, 'b'),
      person(4, 'a'),
      person(5, null),
    ]);
    expect([...presence.keys()]).toEqual(['a', 'b']);
    expect(presence.get('a')?.map((each) => each.clientId)).toEqual([2, 4]);
  });
});

describe('samePresence', () => {
  it('is true when only cursors moved, since cursors are not part of it', () => {
    const before = filePresence([person(2, 'a'), person(3, 'b')]);
    const after = filePresence([person(2, 'a'), person(3, 'b')]);
    expect(samePresence(before, after)).toBe(true);
  });

  it('is false when someone switches file, leaves, or renames', () => {
    const before = filePresence([person(2, 'a'), person(3, 'b')]);
    expect(samePresence(before, filePresence([person(2, 'b'), person(3, 'b')]))).toBe(false);
    expect(samePresence(before, filePresence([person(2, 'a')]))).toBe(false);
    const renamed = person(2, 'a');
    renamed.user = { ...renamed.user, name: 'New name' };
    expect(samePresence(before, filePresence([renamed, person(3, 'b')]))).toBe(false);
  });
});
