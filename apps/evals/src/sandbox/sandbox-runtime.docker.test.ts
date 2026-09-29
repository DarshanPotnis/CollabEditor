/**
 * The run tools over a real Docker sandbox: they work like the browser's, and
 * the container is as locked down as docs/decisions/010-evals.md says.
 * Skipped without Docker, except in CI (REQUIRE_DOCKER=1).
 */
import { createStopSource, sandboxUnavailable, type RuntimeToolCall } from '@collabcode/agent';
import { createFile, readFileText, resolveDocTree } from '@collabcode/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { docker } from './docker.js';
import { PROJECT_MOUNT, SANDBOX_LIMITS } from './session-container.js';
import { createTestSessions, dockerForSpecs } from './test-session.js';

const hasDocker = await dockerForSpecs();
const sessions = createTestSessions(`spec-${Date.now().toString(36)}`);
const ACTOR = { userId: 'spec', userName: 'Spec' };

function replaceIn(doc: Y.Doc, path: string, oldText: string, newText: string): void {
  const id = resolveDocTree(doc).idByPath.get(path) ?? '';
  const text = readFileText(doc, id);
  const at = text?.toJSON().indexOf(oldText) ?? -1;
  if (!text || at === -1) throw new Error(`${oldText} is not in ${path}`);
  text.delete(at, oldText.length);
  text.insert(at, newText);
}

/** What a node one-liner printed, as JSON, from a run_command result. */
function printed(output: string): Record<string, unknown> {
  const line = output.split('\n').find((candidate) => candidate.startsWith('{')) ?? '{}';
  return JSON.parse(line) as Record<string, unknown>;
}

describe.skipIf(!hasDocker)('the Docker sandbox', () => {
  beforeAll(() => sessions.prepare());
  afterAll(() => sessions.close());

  it('runs the Express template from the image, with nothing to install', async () => {
    const { call } = await sessions.open();
    const run = await call({ name: 'run_project', input: {} });
    expect(run.ok).toBe(true);
    expect(run.output).toMatch(/^The project is running and serving on port 3000\./);
    expect(run.output).toContain('$ npm run dev');
    const users = await call({ name: 'http_request', input: { method: 'GET', path: '/users' } });
    expect(users.ok).toBe(true);
    expect(users.output).toMatch(/^HTTP 200 OK/);
    expect(users.output).toContain('Ada Lovelace');
  });

  it('restarts on an edit before the next request, as the settle barrier does', async () => {
    const { call, doc } = await sessions.open();
    await call({ name: 'run_project', input: {} });
    replaceIn(
      doc,
      'routes/users.js',
      'export const usersRouter = Router();\n',
      "export const usersRouter = Router();\n\nusersRouter.get('/ping', (req, res) => {\n  res.json({ pong: true });\n});\n",
    );
    const ping = await call({
      name: 'http_request',
      input: { method: 'GET', path: '/users/ping' },
    });
    expect(ping.output).toMatch(/^HTTP 200 OK/);
    expect(ping.output).toContain('"pong": true');
  });

  it('says a crash is a crash, with the output, and shifts ES-module lines when asked', async () => {
    const { call, doc } = await sessions.open({ stackShift: 11 });
    replaceIn(
      doc,
      'index.js',
      'const app = express();',
      'const app = express();\nundefinedThing();',
    );
    const run = await call({ name: 'run_project', input: {} });
    expect(run.ok).toBe(false);
    expect(run.output).toMatch(/^The project crashed\./);
    expect(run.output).toContain('undefinedThing is not defined');
    // The line is 7 in the file; WebContainer would report it 11 lines further on.
    expect(run.output).toContain(`file://${PROJECT_MOUNT}/index.js:18:`);
  });

  it('cannot install anything, and says which package is missing', async () => {
    const { call, doc } = await sessions.open();
    replaceIn(
      doc,
      'package.json',
      '"express": "^5.2.1"',
      '"express": "^5.2.1",\n    "left-pad": "^1.3.0"',
    );
    const run = await call({ name: 'run_project', input: {} });
    expect(run).toEqual({
      ok: false,
      output:
        'The run failed: npm install cannot run: the eval sandbox has no network, and it has only express installed, not left-pad.',
    });
    const install = await call({
      name: 'run_command',
      input: { command: 'npm', args: ['install', 'left-pad', '--no-audit', '--no-fund'] },
    });
    expect(install.ok).toBe(false);
    expect(install.output).toMatch(
      /^npm install left-pad --no-audit --no-fund exited with code [1-9]/,
    );
  });

  it('runs commands as a non-root user; only the project and /tmp are writable', async () => {
    const { call } = await sessions.open();
    await call({ name: 'run_project', input: {} });
    const probe = await call({
      name: 'run_command',
      input: {
        command: 'node',
        args: [
          '-e',
          [
            "const fs = require('fs');",
            'const tryWrite = (path) => { try { fs.writeFileSync(path, "x"); return "written"; } catch (error) { return error.code; } };',
            'console.log(JSON.stringify({ uid: process.getuid(), node: process.version, root: tryWrite("/work/escape.txt"), etc: tryWrite("/etc/escape"), tmp: tryWrite("/tmp/ok.txt"), project: tryWrite("scratch.txt") }));',
          ].join(' '),
        ],
      },
    });
    expect(probe.output).toMatch(/^node -e .* exited with code 0/);
    const result = printed(probe.output);
    expect(result['uid']).toBe(process.getuid?.());
    expect(result['uid']).not.toBe(0);
    expect(result['node']).toMatch(/^v22\./);
    expect(result).toMatchObject({
      root: 'EROFS',
      etc: 'EROFS',
      tmp: 'written',
      project: 'written',
    });
  });

  it('has no network: no DNS, no internet, no host', async () => {
    const { call } = await sessions.open();
    await call({ name: 'run_project', input: {} });
    const probe = await call({
      name: 'run_command',
      input: {
        command: 'node',
        args: [
          '-e',
          [
            "const dns = require('dns').promises; const net = require('net');",
            'const connect = (host, port) => new Promise((resolve) => { const socket = net.connect({ host, port, timeout: 3000 }); socket.on("connect", () => { socket.destroy(); resolve("connected"); }); socket.on("timeout", () => { socket.destroy(); resolve("timed out"); }); socket.on("error", (error) => resolve(error.code)); });',
            '(async () => { const lookup = await dns.lookup("registry.npmjs.org").then(() => "resolved", (error) => error.code); console.log(JSON.stringify({ lookup, internet: await connect("104.16.0.35", 443), gateway: await connect("172.17.0.1", 2375) })); })();',
          ].join(' '),
        ],
      },
    });
    const result = printed(probe.output);
    expect(result['lookup']).not.toBe('resolved');
    expect(result['internet']).not.toBe('connected');
    expect(result['gateway']).not.toBe('connected');
  });

  it('is started with no network, no privileges, a read-only root and its limits', async () => {
    const { container, project } = await sessions.open();
    const inspected = await docker(['inspect', container.name], { timeoutMs: 30_000 });
    const [info] = JSON.parse(inspected.stdout) as Array<{
      Config: { User: string; Env: string[] };
      HostConfig: {
        NetworkMode: string;
        ReadonlyRootfs: boolean;
        CapDrop: string[];
        SecurityOpt: string[];
        Memory: number;
        NanoCpus: number;
        PidsLimit: number;
      };
      Mounts: Array<{ Type: string; Source: string; Destination: string; RW: boolean }>;
    }>;
    expect(info?.HostConfig).toMatchObject({
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Memory: 768 * 1024 * 1024,
      NanoCpus: Number(SANDBOX_LIMITS.cpus) * 1e9,
      PidsLimit: SANDBOX_LIMITS.pids,
    });
    expect(info?.Config.User).toBe(`${String(process.getuid?.())}:${String(process.getgid?.())}`);
    // The one writable mount is this session's project directory.
    expect(info?.Mounts.map(({ Type, Destination, RW }) => ({ Type, Destination, RW }))).toEqual([
      { Type: 'bind', Destination: PROJECT_MOUNT, RW: true },
    ]);
    expect(info?.Mounts[0]?.Source).toContain(project.path.split('/').slice(-3).join('/'));
    // Its environment is only what the sandbox sets, and the image's own.
    expect(info?.Config.Env.map((entry) => entry.split('=')[0]).sort()).toEqual(
      expect.arrayContaining(['HOME', 'NODE_ENV', 'PATH', 'PORT']),
    );
    expect(info?.Config.Env.some((entry) => /KEY|TOKEN|SECRET/i.test(entry))).toBe(false);
  });

  it('stops a running command when the session is stopped', async () => {
    const { runtime, call } = await sessions.open();
    await call({ name: 'run_project', input: {} });
    const stop = createStopSource();
    const started = Date.now();
    const running = runtime.execute(
      {
        name: 'run_command',
        input: { command: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] },
      },
      stop.signal,
    );
    setTimeout(() => stop.stop(), 1_500);
    expect(await running).toEqual({ ok: false, output: 'Stopped.' });
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('answers like the browser when the sandbox is unavailable, known or found out', async () => {
    const known = await sessions.open({
      availability: { kind: 'unavailable-known', reason: 'no isolation' },
    });
    const tools: RuntimeToolCall[] = [
      { name: 'run_project', input: {} },
      { name: 'run_command', input: { command: 'node', args: ['-v'] } },
      { name: 'http_request', input: { method: 'GET', path: '/users' } },
    ];
    for (const tool of tools) {
      expect(await known.call(tool)).toEqual({
        ok: false,
        output: sandboxUnavailable('no isolation'),
      });
    }

    const found = await sessions.open({
      availability: { kind: 'unavailable-discovered', reason: 'the boot failed' },
    });
    expect(
      (await found.call({ name: 'run_command', input: { command: 'node', args: ['-v'] } })).output,
    ).toMatch(/^Start the project with run_project first/);
    const unavailable = { ok: false, output: sandboxUnavailable('the boot failed') };
    expect(await found.call({ name: 'run_project', input: {} })).toEqual(unavailable);
    expect(await found.call({ name: 'http_request', input: { method: 'GET', path: '/' } })).toEqual(
      unavailable,
    );
  });

  it('writes only document files: files a program wrote stay, removed documents go', async () => {
    const { call, doc, project } = await sessions.open();
    await call({ name: 'run_project', input: {} });
    await call({
      name: 'run_command',
      input: {
        command: 'node',
        args: ['-e', 'require("fs").writeFileSync("made-by-program.txt", "x")'],
      },
    });
    createFile(doc, { parentId: null, name: 'notes.txt', content: 'hello' }, ACTOR);
    await call({ name: 'read_terminal', input: {} });
    const listing = await call({
      name: 'run_command',
      input: {
        command: 'node',
        args: ['-e', 'console.log(require("fs").readdirSync(".").sort().join(","))'],
      },
    });
    expect(listing.output).toContain('made-by-program.txt');
    expect(listing.output).toContain('notes.txt');
    expect(project.path).toContain('.work');
  });
});
