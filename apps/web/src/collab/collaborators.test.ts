import { describe, expect, it } from 'vitest';
import { PRESENCE_COLORS } from '@collabcode/shared';
import { agentHostName, parseCollaborators, remoteOnly } from './collaborators.js';

const ada = { id: 'ada', name: 'Ada', color: PRESENCE_COLORS[0], kind: 'human' };
const grace = { id: 'grace', name: 'Grace', color: PRESENCE_COLORS[1], kind: 'human' };

describe('parseCollaborators', () => {
  it('returns nobody for an empty awareness map', () => {
    expect(parseCollaborators(new Map(), 1)).toEqual([]);
  });

  it('marks the local client as you', () => {
    const states = new Map<number, unknown>([
      [1, { user: ada, activeFileId: null }],
      [2, { user: grace, activeFileId: 'file1' }],
    ]);

    expect(parseCollaborators(states, 1)).toEqual([
      { clientId: 1, user: ada, activeFileId: null, isYou: true, agent: null },
      { clientId: 2, user: grace, activeFileId: 'file1', isYou: false, agent: null },
    ]);
  });

  it('sorts by client id so avatars do not shuffle', () => {
    const states = new Map<number, unknown>([
      [30, { user: ada }],
      [10, { user: grace }],
      [20, { user: ada }],
    ]);
    expect(parseCollaborators(states, 0).map((c) => c.clientId)).toEqual([10, 20, 30]);
  });

  it('drops states that do not parse instead of rendering them', () => {
    const states = new Map<number, unknown>([
      [1, { user: ada }],
      [2, null],
      [3, {}],
      [4, 'hello'],
      [5, { user: { ...grace, color: 'red; } body { display: none } .x {' } }],
      [6, { user: { ...grace, kind: 'admin' } }],
      [7, { user: { ...grace, name: '' } }],
    ]);

    expect(parseCollaborators(states, 1).map((c) => c.clientId)).toEqual([1]);
  });

  it('keeps a peer whose state carries extra fields, such as y-monaco selections', () => {
    const states = new Map<number, unknown>([
      [2, { user: grace, activeFileId: 'file1', selection: { anchor: {}, head: {} } }],
    ]);
    expect(parseCollaborators(states, 1)).toHaveLength(1);
  });

  it('sanitizes a hostile name rather than dropping the peer', () => {
    const states = new Map<number, unknown>([
      [2, { user: { ...grace, name: 'Gr\u0000ace‮  Hopper' } }],
    ]);
    expect(parseCollaborators(states, 1)[0]?.user.name).toBe('Grace Hopper');
  });
});

describe('remoteOnly', () => {
  it('leaves you out', () => {
    const states = new Map<number, unknown>([
      [1, { user: ada }],
      [2, { user: grace }],
    ]);
    expect(remoteOnly(parseCollaborators(states, 1)).map((c) => c.clientId)).toEqual([2]);
  });
});

describe('agents', () => {
  const agentUser = {
    id: 'agent-s1',
    name: 'AI teammate',
    color: PRESENCE_COLORS[2],
    kind: 'agent',
  };
  const info = { hostUserId: 'ada', hostName: 'Ada', sessionId: 's1', status: 'Editing a.js' };

  it('keeps what an agent says about itself, and ignores it on a person', () => {
    const states = new Map<number, unknown>([
      [1, { user: agentUser, agent: info }],
      [2, { user: grace, agent: info }],
    ]);
    const [agent, person] = parseCollaborators(states, 0);
    expect(agent?.agent).toEqual(info);
    expect(person?.agent).toBeNull();
  });

  it('names the host by what they show now, not what the agent claims', () => {
    const collaborators = parseCollaborators(
      new Map<number, unknown>([
        [1, { user: { ...ada, name: 'Ada L.' } }],
        [2, { user: agentUser, agent: { ...info, hostName: 'Someone Famous' } }],
      ]),
      0,
    );
    expect(agentHostName(info, collaborators)).toBe('Ada L.');
  });

  it('has no host name when the host has left, or when only an agent has that id', () => {
    const onlyAgents = parseCollaborators(
      new Map<number, unknown>([[2, { user: { ...agentUser, id: 'ada' }, agent: info }]]),
      0,
    );
    expect(agentHostName(info, onlyAgents)).toBeNull();
  });
});
