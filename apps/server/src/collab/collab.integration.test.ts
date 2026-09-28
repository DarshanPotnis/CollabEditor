/**
 * Integration tests for the collab server: the real Hocuspocus instance, the
 * real project guard and the real database extension, against an in-memory
 * repo. Clients are real HocuspocusProviders over Node's WebSocket.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { TEMPLATES, readFileText, resolveDocTree } from '@collabcode/shared';
import { startTestServer, type TestServer } from './test-server.js';
import { COLLAB_REJECTION_REASONS } from './rejection.js';
import {
  connectClient,
  readStoredFile,
  seedProject,
  waitUntil,
  type Client,
} from '../test/support.js';

let server: TestServer;
const openClients: Client[] = [];

function track(client: Client): Client {
  openClients.push(client);
  return client;
}

beforeAll(async () => {
  server = await startTestServer();
});

afterEach(() => {
  while (openClients.length > 0) openClients.pop()?.destroy();
});

afterAll(async () => {
  await server.stop();
});

describe('syncing', () => {
  it('gives a joining client the stored document', async () => {
    const project = await seedProject(server.repo, 'Stored project');
    const client = track(await connectClient(server.collabUrl, project));

    expect(client.doc.getMap('meta').get('name')).toBe('Stored project');
    expect(client.text.toJSON()).toContain('Hello from CollabCode');
  });

  it('merges concurrent edits at the same position instead of losing one', async () => {
    const project = await seedProject(server.repo);
    const a = track(await connectClient(server.collabUrl, project));
    const b = track(await connectClient(server.collabUrl, project));

    a.doc.transact(() => a.text.insert(0, 'AAA'), 'test');
    b.doc.transact(() => b.text.insert(0, 'BBB'), 'test');

    await waitUntil(() => a.text.toJSON() === b.text.toJSON(), 'the two clients to converge');

    const converged = a.text.toJSON();
    expect(converged).toContain('AAA');
    expect(converged).toContain('BBB');
  });

  it('shows a late joiner what the others have already written', async () => {
    const project = await seedProject(server.repo);
    const first = track(await connectClient(server.collabUrl, project));
    first.doc.transact(() => first.text.insert(0, '// written before you arrived\n'), 'test');

    const late = track(await connectClient(server.collabUrl, project));
    await waitUntil(
      () => late.text.toJSON().includes('before you arrived'),
      'the late joiner to receive existing content',
    );
  });

  it('merges edits made while a client was disconnected', async () => {
    const project = await seedProject(server.repo);
    const a = track(await connectClient(server.collabUrl, project));
    const b = track(await connectClient(server.collabUrl, project));

    b.provider.disconnect();
    await waitUntil(() => !b.provider.synced, 'the second client to go offline');

    a.doc.transact(() => a.text.insert(0, 'online-edit\n'), 'test');
    b.doc.transact(() => b.text.insert(0, 'offline-edit\n'), 'test');
    expect(a.text.toJSON()).not.toContain('offline-edit');

    await b.provider.connect();
    await waitUntil(() => b.provider.synced, 'the second client to come back');

    await waitUntil(() => a.text.toJSON() === b.text.toJSON(), 'both clients to converge again');
    expect(a.text.toJSON()).toContain('online-edit');
    expect(a.text.toJSON()).toContain('offline-edit');
  });
});

describe('persistence', () => {
  it('persists an edit even when the client disconnects immediately afterwards', async () => {
    const project = await seedProject(server.repo);
    const client = await connectClient(server.collabUrl, project);

    client.doc.transact(() => client.text.insert(0, 'saved-on-the-way-out\n'), 'test');
    // No pause: the update and the socket close are sent back to back, which is
    // what happens when someone closes the tab right after typing.
    client.destroy();

    await waitUntil(
      async () => (await readStoredFile(server.repo, project)).includes('saved-on-the-way-out'),
      'the edit to reach storage',
    );
  });

  it('keeps everything when the server restarts', async () => {
    const project = await seedProject(server.repo);
    const client = await connectClient(server.collabUrl, project);
    client.doc.transact(() => client.text.insert(0, 'survives-restart\n'), 'test');
    client.destroy();

    await waitUntil(
      async () => (await readStoredFile(server.repo, project)).includes('survives-restart'),
      'the edit to reach storage',
    );

    await server.stop();
    server = await startTestServer({ repo: server.repo });

    const reconnected = track(await connectClient(server.collabUrl, project));
    expect(reconnected.text.toJSON()).toContain('survives-restart');
  });
});

describe('refusing unknown documents', () => {
  async function expectRejection(documentName: string): Promise<string> {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: server.collabUrl,
      name: documentName,
      document: doc,
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no rejection arrived')), 8_000);
        provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
          clearTimeout(timer);
          resolve(reason);
        });
        provider.on('synced', () => {
          clearTimeout(timer);
          reject(new Error('the server accepted a document it should have refused'));
        });
      });
    } finally {
      provider.destroy();
      doc.destroy();
    }
  }

  it('refuses a well-formed id that is not a project', async () => {
    expect(await expectRejection('zzzzzzzzzzzz')).toBe(COLLAB_REJECTION_REASONS.projectNotFound);
  });

  it('refuses a malformed project id', async () => {
    expect(await expectRejection('../../etc/passwd')).toBe(
      COLLAB_REJECTION_REASONS.invalidProjectId,
    );
  });

  it('does not create a row for a refused project', async () => {
    const before = server.repo.size;
    await expectRejection('yyyyyyyyyyyy');
    expect(server.repo.size).toBe(before);
  });
});

describe('document shape', () => {
  it('serves a document that matches the shared schema readers', async () => {
    const project = await seedProject(server.repo);
    const client = track(await connectClient(server.collabUrl, project));

    expect(readFileText(client.doc, project.entryFileId)).toBeInstanceOf(Y.Text);
    const tree = resolveDocTree(client.doc);
    expect(tree.idByPath.get(TEMPLATES['blank-node'].entryPath)).toBe(project.entryFileId);
    expect(tree.byId.size).toBe(TEMPLATES['blank-node'].files.length);
  });
});

describe('an AI agent as a peer', () => {
  /**
   * What apps/web/src/features/agent/agent-peer.ts does: a second Y.Doc in the
   * person's tab, on its own connection. The server has nothing special for it.
   */
  it('is just another connection: its edits and presence reach everyone, and leave with it', async () => {
    const project = await seedProject(server.repo);
    const host = track(await connectClient(server.collabUrl, project));
    const agent = await connectClient(server.collabUrl, project);
    const collaborator = track(await connectClient(server.collabUrl, project));
    const awarenessOf = (client: Client): NonNullable<HocuspocusProvider['awareness']> => {
      const awareness = client.provider.awareness;
      if (!awareness) throw new Error('no awareness');
      return awareness;
    };

    expect(agent.doc.clientID).not.toBe(host.doc.clientID);
    awarenessOf(agent).setLocalState({ user: { id: 'agent-s1', kind: 'agent' } });
    agent.doc.transact(() => agent.text.insert(0, '// by the agent\n'), 'collabcode:agent:s1');

    for (const client of [host, collaborator]) {
      await waitUntil(
        () => client.text.toJSON().startsWith('// by the agent'),
        'the agent edit to arrive',
      );
      await waitUntil(
        () => awarenessOf(client).getStates().get(agent.doc.clientID) !== undefined,
        'the agent to appear',
      );
    }

    agent.destroy();
    await waitUntil(
      () => awarenessOf(collaborator).getStates().get(agent.doc.clientID) === undefined,
      'the agent to leave',
    );
    host.text.insert(0, 'still here ');
    await waitUntil(
      () => collaborator.text.toJSON().startsWith('still here'),
      'the host to keep working',
    );
  });
});
