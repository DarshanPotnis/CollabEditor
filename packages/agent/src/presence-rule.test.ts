import { describe, expect, it } from 'vitest';
import { PRESENCE_WINDOW_MS, someoneElseEditing, type PeerPresence } from './presence-rule.js';

const NOW = 100_000;

function source(peers: PeerPresence[]) {
  return { hostUserId: 'host', selfClientId: 1, peers: () => peers };
}

function peer(overrides: Partial<PeerPresence>): PeerPresence {
  return { clientId: 2, userId: 'bob', activeFileId: 'f1', lastEditAt: NOW - 1_000, ...overrides };
}

describe('someoneElseEditing', () => {
  it('is true for another person who has the file open and just edited', () => {
    expect(someoneElseEditing(source([peer({})]), 'f1', NOW)).toBe(true);
  });

  it.each([
    ['the host', { userId: 'host' }],
    ['the agent itself', { clientId: 1 }],
    ['someone in another file', { activeFileId: 'f2' }],
    ['someone with no file open', { activeFileId: null }],
    ['someone who has not edited', { lastEditAt: null }],
    ['someone who went quiet', { lastEditAt: NOW - PRESENCE_WINDOW_MS }],
  ])('is false for %s', (_label, overrides) => {
    expect(someoneElseEditing(source([peer(overrides)]), 'f1', NOW)).toBe(false);
  });

  it('counts any peer but the host and itself, since a claim to be an agent proves nothing', () => {
    expect(someoneElseEditing(source([peer({ userId: 'agent-x' })]), 'f1', NOW)).toBe(true);
  });
});
