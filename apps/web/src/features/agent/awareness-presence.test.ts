import { PRESENCE_COLORS } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createAwarenessPresence } from './awareness-presence.js';

const bob = { id: 'bob', name: 'Bob', color: PRESENCE_COLORS[3], kind: 'human' };

function relay(from: Awareness, to: Awareness): void {
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), 'remote');
}

describe('createAwarenessPresence', () => {
  it('reports each peer, with edit times on this clock', () => {
    const agent = new Awareness(new Y.Doc());
    const person = new Awareness(new Y.Doc());
    let now = 1_700_000_000_000;
    const presence = createAwarenessPresence(agent, 'ada', () => now);

    // Bob's clock runs an hour behind ours.
    person.setLocalState({ user: bob, activeFileId: 'f1', lastEditAt: now - 3_600_000 });
    relay(person, agent);
    expect(presence.peers().find((peer) => peer.userId === 'bob')?.lastEditAt).toBeNull();

    now += 2_000;
    person.setLocalStateField('lastEditAt', now - 3_600_000 + 1);
    relay(person, agent);
    expect(presence.peers().find((peer) => peer.userId === 'bob')).toEqual({
      clientId: person.clientID,
      userId: 'bob',
      activeFileId: 'f1',
      lastEditAt: now,
    });
    expect(presence.selfClientId).toBe(agent.clientID);
    expect(presence.hostUserId).toBe('ada');
    presence.dispose();
  });

  it('leaves out peers whose state does not parse, and forgets those who leave', () => {
    const agent = new Awareness(new Y.Doc());
    const person = new Awareness(new Y.Doc());
    const presence = createAwarenessPresence(agent, 'ada', () => 0);
    person.setLocalState({ user: { ...bob, color: 'red' }, activeFileId: 'f1' });
    relay(person, agent);
    expect(presence.peers().map((peer) => peer.userId)).not.toContain('bob');

    person.setLocalState({ user: bob, activeFileId: 'f1', lastEditAt: 0 });
    relay(person, agent);
    removeAwarenessStates(agent, [person.clientID], 'remote');
    expect(presence.peers().map((peer) => peer.userId)).not.toContain('bob');
  });
});
