import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createFile,
  createFolder,
  initProjectDoc,
  move,
  purgeDeleted,
  readFileText,
  rename,
  resolveDocTree,
  restore,
  softDelete,
} from '@collabcode/shared';
import { FakeContainerFs } from '../../../test/fake-container-fs.js';
import { createFsBridge, type FsBridge, type SyncResult } from './fs-bridge.js';

const ada = { userId: 'ada', userName: 'Ada' };
const bridges: FsBridge[] = [];

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.stop();
  vi.useRealTimers();
});

function express(): Y.Doc {
  const doc = new Y.Doc();
  initProjectDoc(doc, { name: 'API', template: 'express-api' });
  return doc;
}

function idOf(doc: Y.Doc, path: string): string {
  const id = resolveDocTree(doc).idByPath.get(path);
  if (id === undefined) throw new Error(`no ${path}`);
  return id;
}

async function running(doc: Y.Doc) {
  const fs = new FakeContainerFs();
  const errors: Array<[string | null, unknown]> = [];
  const synced: SyncResult[] = [];
  const bridge = createFsBridge({
    doc,
    fs,
    onError: (path, error) => errors.push([path, error]),
    onSynced: (result) => synced.push(result),
  });
  bridges.push(bridge);
  await bridge.start();
  return { fs, bridge, errors, synced };
}

describe('fs bridge', () => {
  it('writes the whole project on start, folders included', async () => {
    const { fs, errors } = await running(express());
    expect(fs.paths()).toEqual(['index.js', 'package.json', 'routes/users.js']);
    expect(fs.dirs.has('routes')).toBe(true);
    expect(fs.files.get('routes/users.js')).toContain('Router');
    expect(errors).toEqual([]);
  });

  it('writes only the file that changed', async () => {
    const doc = express();
    const { fs, bridge, synced } = await running(doc);
    fs.calls.length = 0;

    readFileText(doc, idOf(doc, 'routes/users.js'))?.insert(0, '// edited\n');
    await bridge.flush();

    expect(fs.calls).toEqual(['write routes/users.js']);
    expect(fs.files.get('routes/users.js')).toMatch(/^\/\/ edited/);
    expect(synced.at(-1)).toEqual({ written: ['routes/users.js'], removed: [] });
  });

  it('coalesces a burst of typing into one write after a quiet moment', async () => {
    vi.useFakeTimers();
    const doc = express();
    const { fs } = await running(doc);
    fs.calls.length = 0;
    const text = readFileText(doc, idOf(doc, 'index.js'));

    for (const char of 'hello') {
      text?.insert(0, char);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(fs.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(fs.calls).toEqual(['write index.js']);
  });

  it('turns a rename into a remove and a write', async () => {
    const doc = express();
    const { fs, bridge } = await running(doc);
    rename(doc, idOf(doc, 'routes/users.js'), 'people.js');
    await bridge.flush();
    expect(fs.paths()).toEqual(['index.js', 'package.json', 'routes/people.js']);
  });

  it('moves every file when a folder is renamed, and removes the old folder', async () => {
    const doc = express();
    const { fs, bridge } = await running(doc);
    rename(doc, idOf(doc, 'routes'), 'api');
    await bridge.flush();
    expect(fs.paths()).toEqual(['api/users.js', 'index.js', 'package.json']);
    expect(fs.dirs.has('routes')).toBe(false);
  });

  it('follows a file moved into another folder', async () => {
    const doc = express();
    const { fs, bridge } = await running(doc);
    const lib = createFolder(doc, { parentId: null, name: 'lib' }, ada);
    move(doc, idOf(doc, 'routes/users.js'), lib);
    await bridge.flush();
    expect(fs.paths()).toEqual(['index.js', 'lib/users.js', 'package.json']);
  });

  it('removes a deleted file and writes it back when it is restored', async () => {
    const doc = express();
    const { fs, bridge, synced } = await running(doc);
    const users = idOf(doc, 'routes/users.js');

    softDelete(doc, users, ada);
    await bridge.flush();
    expect(fs.files.has('routes/users.js')).toBe(false);
    expect(synced.at(-1)).toEqual({ written: [], removed: ['routes/users.js'] });

    restore(doc, users);
    await bridge.flush();
    expect(fs.files.has('routes/users.js')).toBe(true);
    expect(synced.at(-1)).toEqual({ written: ['routes/users.js'], removed: [] });
  });

  it('removes a file deleted forever', async () => {
    const doc = express();
    const { fs, bridge } = await running(doc);
    softDelete(doc, idOf(doc, 'routes'), ada);
    purgeDeleted(doc, 'all');
    await bridge.flush();
    expect(fs.paths()).toEqual(['index.js', 'package.json']);
  });

  it('never touches what npm or the program wrote, even inside a deleted folder', async () => {
    const doc = express();
    const { fs, bridge } = await running(doc);
    // What `npm install` and a running program leave behind.
    await fs.mkdir('node_modules/express', { recursive: true });
    await fs.writeFile('node_modules/express/index.js', 'module.exports = {}');
    await fs.writeFile('package-lock.json', '{}');
    await fs.writeFile('routes/cache.log', 'written by the server');

    for (const path of ['routes', 'index.js', 'package.json'])
      softDelete(doc, idOf(doc, path), ada);
    await bridge.flush();

    expect(fs.paths()).toEqual([
      'node_modules/express/index.js',
      'package-lock.json',
      'routes/cache.log',
    ]);
    expect(fs.dirs.has('routes')).toBe(true);
  });

  it('writes both files when two people created the same name at once', async () => {
    const doc = express();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    createFile(doc, { parentId: null, name: 'utils.js', content: 'a' }, ada);
    createFile(
      other,
      { parentId: null, name: 'utils.js', content: 'b' },
      { userId: 'bo', userName: 'Bo' },
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

    const { fs } = await running(doc);
    expect(fs.paths()).toContain('utils.js');
    expect(fs.paths()).toContain('utils (2).js');
  });

  it('reports a failed write and retries it on the next sync, without blocking others', async () => {
    const doc = express();
    const fs = new FakeContainerFs();
    fs.failNextWrite.add('index.js');
    const errors: Array<string | null> = [];
    const bridge = createFsBridge({
      doc,
      fs,
      onError: (path) => errors.push(path),
      onSynced: () => undefined,
    });
    bridges.push(bridge);

    await bridge.start();
    expect(errors).toEqual(['index.js']);
    expect(fs.paths()).toEqual(['package.json', 'routes/users.js']);

    readFileText(doc, idOf(doc, 'package.json'))?.insert(0, ' ');
    await bridge.flush();
    expect(fs.paths()).toEqual(['index.js', 'package.json', 'routes/users.js']);
  });

  it('writes nothing after it is stopped', async () => {
    const doc = express();
    const { fs, bridge } = await running(doc);
    bridge.stop();
    fs.calls.length = 0;
    readFileText(doc, idOf(doc, 'index.js'))?.insert(0, 'x');
    await bridge.flush();
    expect(fs.calls).toEqual([]);
  });
});
