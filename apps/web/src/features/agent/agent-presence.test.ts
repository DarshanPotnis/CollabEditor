import { createProjectUpdate, parseAwarenessState, resolveDocTree } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { remoteCursorIndex } from '../../collab/remote-selection.js';
import { AGENT_NAME, publishAgentPresence } from './agent-presence.js';

function room() {
  const human = new Y.Doc();
  Y.applyUpdate(human, createProjectUpdate({ name: 'Demo', template: 'express-api' }).update);
  const agentDoc = new Y.Doc();
  Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(human));
  const awareness = new Awareness(agentDoc);
  let now = 5_000;
  const presence = publishAgentPresence({
    awareness,
    doc: agentDoc,
    sessionId: 's1',
    host: { userId: 'ada', name: 'Ada' },
    now: () => now,
  });
  const fileId = resolveDocTree(human).idByPath.get('routes/users.js') ?? '';
  const state = () => awareness.getLocalState();
  return { human, presence, fileId, state, tick: (ms: number) => (now += ms) };
}

describe('publishAgentPresence', () => {
  it('shows an agent working for its host, in a form every peer accepts', () => {
    const { state } = room();
    expect(parseAwarenessState(state())).toEqual({
      user: {
        id: 'agent-s1',
        name: AGENT_NAME,
        color: expect.any(String) as string,
        kind: 'agent',
      },
      activeFileId: null,
      agent: { hostUserId: 'ada', hostName: 'Ada', sessionId: 's1', status: 'Starting' },
    });
  });

  it("puts its caret where it edited, where a person's editor finds it", () => {
    const { human, presence, fileId, state } = room();
    presence.showActivity({ tool: 'edit_file', path: 'routes/users.js', fileId, cursor: 42 });

    expect(state()?.activeFileId).toBe(fileId);
    expect(state()?.lastEditAt).toBe(5_000);
    const text = human.getMap<Y.Text>('contents').get(fileId);
    if (!text) throw new Error('no text');
    // What y-monaco does with it: the state travels as JSON.
    const received: unknown = JSON.parse(JSON.stringify(state()));
    expect(remoteCursorIndex(received, text)).toBe(42);
  });

  it('opens a file it reads without a caret, and leaves one it deleted', () => {
    const { presence, fileId, state } = room();
    presence.showActivity({ tool: 'read_file', path: 'routes/users.js', fileId, cursor: null });
    expect(state()).toMatchObject({ activeFileId: fileId, selection: null });
    expect(state()?.lastEditAt).toBeUndefined();
    presence.showActivity({
      tool: 'delete_file',
      path: 'routes/users.js',
      fileId: null,
      cursor: null,
    });
    expect(state()).toMatchObject({ activeFileId: null, selection: null });
  });

  it('keeps its file while it lists or searches', () => {
    const { presence, fileId, state } = room();
    presence.showActivity({ tool: 'read_file', path: 'routes/users.js', fileId, cursor: null });
    presence.showActivity({ tool: 'search_code', path: '', fileId: null, cursor: null });
    expect(state()?.activeFileId).toBe(fileId);
  });

  it('updates its status, within what awareness allows', () => {
    const { presence, state } = room();
    presence.setStatus(`Editing ${'x'.repeat(200)}`);
    expect(parseAwarenessState(state())?.agent?.status).toHaveLength(80);
  });
});
