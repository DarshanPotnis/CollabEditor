import {
  agentOrigin,
  createAgentUndo,
  createProjectUpdate,
  readFileContent,
  readNode,
  resolveDocTree,
  type AgentToolInput,
} from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { PeerPresence } from '../presence-rule.js';
import { neverStopped } from '../test/support.js';
import { instantTypist } from '../typist.js';
import {
  createDocTools,
  READ_MAX_LINES,
  type DocActivity,
  type DocToolCall,
} from './file-tools.js';

const ORIGIN = agentOrigin('session-1');
const AGENT = { userId: 'agent-session-1', userName: 'AI teammate' };
const HOST = 'host-user';
const NOW = 1_000_000;

/** The Express API template, and the agent's tools over it. */
function setup(peers: PeerPresence[] = []) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, createProjectUpdate({ name: 'Demo', template: 'express-api' }).update);
  const undo = createAgentUndo(doc, ORIGIN);
  const activity: DocActivity[] = [];
  const origins: unknown[] = [];
  doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
  const tools = createDocTools({
    doc,
    origin: ORIGIN,
    actor: AGENT,
    undo,
    presence: { hostUserId: HOST, selfClientId: 99, peers: () => peers },
    typist: instantTypist,
    now: () => NOW,
    onActivity: (entry) => activity.push(entry),
  });
  const run = (call: DocToolCall) => tools.execute(call, neverStopped);
  const idOf = (path: string): string => {
    const id = resolveDocTree(doc).idByPath.get(path);
    if (id === undefined) throw new Error(`no ${path}`);
    return id;
  };
  return { doc, undo, activity, origins, run, idOf };
}

const edit = (input: AgentToolInput<'edit_file'>): DocToolCall => ({ name: 'edit_file', input });

describe('list_files', () => {
  it('lists folders and files in tree order, with sizes', async () => {
    const { run } = setup();
    const { ok, output } = await run({ name: 'list_files', input: {} });
    expect(ok).toBe(true);
    expect(output.split('\n').map((line) => line.replace(/ {2}[\d,]+ chars$/, ''))).toEqual([
      'routes/',
      'routes/users.js',
      'index.js',
      'package.json',
    ]);
  });
});

describe('read_file', () => {
  it('numbers lines with their real numbers', async () => {
    const { run } = setup();
    const { output } = await run({
      name: 'read_file',
      input: { path: 'routes/users.js', startLine: 4, endLine: 5 },
    });
    expect(output).toBe(
      "routes/users.js, lines 4–5 of 23:\n4|   { id: 1, name: 'Ada Lovelace', role: 'engineer' },\n5|   { id: 2, name: 'Grace Hopper', role: 'engineer' },",
    );
  });

  it('accepts a path written as ./path or /path', async () => {
    const { run } = setup();
    for (const path of ['./index.js', '/index.js', 'routes//users.js']) {
      expect((await run({ name: 'read_file', input: { path } })).ok).toBe(true);
    }
  });

  it('suggests what the model probably meant', async () => {
    const { run } = setup();
    expect(await run({ name: 'read_file', input: { path: 'Routes/Users.js' } })).toEqual({
      ok: false,
      output: 'There is no "Routes/Users.js" in the project. Did you mean "routes/users.js"?',
    });
    expect((await run({ name: 'read_file', input: { path: 'users.js' } })).output).toContain(
      '"routes/users.js"',
    );
  });

  it('refuses a path that climbs out of the project', async () => {
    const { run } = setup();
    expect((await run({ name: 'read_file', input: { path: '../etc/passwd' } })).output).toMatch(
      /"\.\." is not allowed/,
    );
  });

  it('shows a long file in parts and says how to read on', async () => {
    const { doc, run } = setup();
    await run({
      name: 'create_file',
      input: {
        path: 'big.txt',
        content: Array.from({ length: 500 }, (_, i) => `line ${String(i + 1)}`).join('\n'),
      },
    });
    const { output } = await run({ name: 'read_file', input: { path: 'big.txt' } });
    expect(output.startsWith(`big.txt, lines 1–${String(READ_MAX_LINES)} of 500:`)).toBe(true);
    expect(output.endsWith(`…[showing lines 1–400 of 500; read on with startLine 401]`)).toBe(true);
    expect(readFileContent(doc, resolveDocTree(doc).idByPath.get('big.txt') ?? '')).toContain(
      'line 500',
    );
  });

  it('refuses a folder, and a start past the end', async () => {
    const { run } = setup();
    expect((await run({ name: 'read_file', input: { path: 'routes' } })).output).toMatch(
      /is a folder/,
    );
    expect(await run({ name: 'read_file', input: { path: 'index.js', startLine: 999 } })).toEqual({
      ok: false,
      output: 'index.js has 17 lines.',
    });
  });
});

describe('search_code', () => {
  it('finds text in every file, ignoring case, with real line numbers', async () => {
    const { run } = setup();
    const { output } = await run({ name: 'search_code', input: { query: 'USERSROUTER' } });
    expect(output.split('\n')).toEqual([
      'routes/users.js:8: export const usersRouter = Router();',
      "routes/users.js:10: usersRouter.get('/', (req, res) => {",
      "routes/users.js:14: usersRouter.post('/', (req, res) => {",
      "index.js:4: import { usersRouter } from './routes/users.js';",
      "index.js:8: app.use('/users', usersRouter);",
    ]);
  });

  it('says when nothing matches', async () => {
    const { run } = setup();
    expect(await run({ name: 'search_code', input: { query: 'zebra' } })).toEqual({
      ok: true,
      output: 'No matches for "zebra".',
    });
  });
});

describe('edit_file', () => {
  it("writes with the session's origin, says where, and can be undone", async () => {
    const { doc, run, undo, origins, activity, idOf } = setup();
    const result = await run(
      edit({
        path: 'routes/users.js',
        oldText: "usersRouter.get('/', (req, res) => {\n  res.json(users);\n});",
        newText:
          "usersRouter.get('/', (req, res) => {\n  res.json(users);\n});\n\nusersRouter.delete('/:id', (req, res) => {\n  res.status(204).end();\n});",
      }),
    );
    expect(result).toEqual({ ok: true, output: 'Edited routes/users.js (changed lines 12–16).' });
    expect(origins).toEqual([ORIGIN]);
    expect(activity.at(-1)).toMatchObject({
      tool: 'edit_file',
      path: 'routes/users.js',
      fileId: idOf('routes/users.js'),
    });

    undo.undo({ ...AGENT, now: NOW });
    expect(readFileContent(doc, idOf('routes/users.js'))).not.toContain('delete');
  });

  it('refuses text that is not there or not unique, naming the file', async () => {
    const { run } = setup();
    expect(await run(edit({ path: 'index.js', oldText: 'nope', newText: 'x' }))).toEqual({
      ok: false,
      output:
        'index.js: The text to replace is not in the file. It may have changed since it was read.',
    });
    expect(
      (await run(edit({ path: 'routes/users.js', oldText: 'usersRouter', newText: 'x' }))).output,
    ).toMatch(/appears 3 times/);
  });

  describe('the presence rule', () => {
    const editing = (userId: string, fileId: string, lastEditAt: number | null): PeerPresence => ({
      clientId: 7,
      userId,
      activeFileId: fileId,
      lastEditAt,
    });

    async function tryEdit(peer: (fileId: string) => PeerPresence) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, createProjectUpdate({ name: 'Demo', template: 'express-api' }).update);
      const fileId = resolveDocTree(doc).idByPath.get('index.js') ?? '';
      const tools = createDocTools({
        doc,
        origin: ORIGIN,
        actor: AGENT,
        undo: createAgentUndo(doc, ORIGIN),
        presence: { hostUserId: HOST, selfClientId: 99, peers: () => [peer(fileId)] },
        typist: instantTypist,
        now: () => NOW,
      });
      return tools.execute(
        edit({ path: 'index.js', oldText: 'const port', newText: 'const PORT' }),
        neverStopped,
      );
    }

    it('refuses a file someone else edited in the last 30 seconds', async () => {
      expect(await tryEdit((fileId) => editing('bob', fileId, NOW - 5_000))).toEqual({
        ok: false,
        output:
          'Someone else is editing index.js right now, so leave it alone. Say in your summary what you would change there.',
      });
    });

    it('edits the host’s own file, a file whose editor went quiet, and one only looked at', async () => {
      expect((await tryEdit((fileId) => editing(HOST, fileId, NOW))).ok).toBe(true);
      expect((await tryEdit((fileId) => editing('bob', fileId, NOW - 31_000))).ok).toBe(true);
      expect((await tryEdit((fileId) => editing('bob', fileId, null))).ok).toBe(true);
    });

    it('also respects another agent, whatever it claims to be', async () => {
      expect((await tryEdit((fileId) => editing('agent-other', fileId, NOW))).ok).toBe(false);
    });
  });
});

describe('create_file', () => {
  it('creates the file and any missing folders, and undo removes them softly', async () => {
    const { doc, run, undo, idOf } = setup();
    expect(
      await run({
        name: 'create_file',
        input: { path: 'lib/util/format.js', content: 'export {};\n' },
      }),
    ).toEqual({
      ok: true,
      output: 'Created lib/util/format.js (1 line).',
    });
    const fileId = idOf('lib/util/format.js');
    expect(readNode(doc, fileId)).toMatchObject({ createdBy: AGENT.userId, createdAt: NOW });

    undo.undo({ ...AGENT, now: NOW });
    const paths = [...resolveDocTree(doc).byId.values()].map((node) => node.path);
    expect(paths).not.toContain('lib');
    expect(readNode(doc, fileId)?.deletedBy).toBe(AGENT.userId);
  });

  it('refuses a path that exists or runs through a file', async () => {
    const { run } = setup();
    expect(
      (await run({ name: 'create_file', input: { path: 'index.js', content: '' } })).output,
    ).toMatch(/already exists\. Use edit_file/);
    expect(
      (await run({ name: 'create_file', input: { path: 'index.js/x.js', content: '' } })).output,
    ).toBe('"index.js" is a file, not a folder.');
  });

  it('passes on the tree rules’ refusals', async () => {
    const { run } = setup();
    const result = await run({ name: 'create_file', input: { path: 'ROUTES/x.js', content: '' } });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/clashes with "routes"/);
  });
});

describe('rename_file', () => {
  it('renames and moves in one call, and undo puts it back', async () => {
    const { doc, run, undo, idOf } = setup();
    const id = idOf('index.js');
    expect(
      await run({ name: 'rename_file', input: { path: 'index.js', newPath: 'src/server.js' } }),
    ).toEqual({
      ok: true,
      output: 'Renamed index.js to src/server.js.',
    });
    undo.undo({ ...AGENT, now: NOW });
    expect(resolveDocTree(doc).byId.get(id)?.path).toBe('index.js');
  });

  it('refuses a folder with a file someone else is editing', async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, createProjectUpdate({ name: 'Demo', template: 'express-api' }).update);
    const users = resolveDocTree(doc).idByPath.get('routes/users.js') ?? '';
    const tools = createDocTools({
      doc,
      origin: ORIGIN,
      actor: AGENT,
      undo: createAgentUndo(doc, ORIGIN),
      presence: {
        hostUserId: HOST,
        selfClientId: 99,
        peers: () => [{ clientId: 3, userId: 'bob', activeFileId: users, lastEditAt: NOW }],
      },
      typist: instantTypist,
      now: () => NOW,
    });
    for (const call of [
      { name: 'rename_file', input: { path: 'routes', newPath: 'api' } },
      { name: 'delete_file', input: { path: 'routes' } },
    ] as const) {
      expect((await tools.execute(call, neverStopped)).output).toMatch(
        /^Someone else is editing routes\/users\.js/,
      );
    }
  });
});

describe('delete_file', () => {
  it('deletes softly, in the agent’s name, and undo restores it', async () => {
    const { doc, run, undo, idOf } = setup();
    const id = idOf('routes/users.js');
    expect((await run({ name: 'delete_file', input: { path: 'routes/users.js' } })).output).toBe(
      'Deleted routes/users.js. People can restore it from Recently deleted.',
    );
    expect(readNode(doc, id)).toMatchObject({
      deletedBy: AGENT.userId,
      deletedByName: 'AI teammate',
    });
    expect(readFileContent(doc, id)).toContain('usersRouter');

    undo.undo({ ...AGENT, now: NOW });
    expect(readNode(doc, id)?.deletedAt).toBeNull();
  });
});
