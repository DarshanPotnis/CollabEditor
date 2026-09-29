/**
 * The key canary for the sandbox (docs/decisions/010-evals.md). While this
 * process holds a canary key, loaded exactly as CI loads the real one, a
 * hostile program (fixtures/hostile/find-key.cjs) runs in the sandbox and
 * searches its environment, every process it can see, the whole filesystem
 * and every way out. It must find nothing, and the key must be in nothing the
 * run leaves behind. Skipped without Docker, except in CI (REQUIRE_DOCKER=1).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFile } from '@collabcode/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEvalKey } from '../secrets/eval-key.js';
import { WORK_ROOT } from './project-dir.js';
import { createTestSessions, dockerForSpecs } from './test-session.js';

const hasDocker = await dockerForSpecs();
const runId = `canary-${Date.now().toString(36)}`;
const sessions = createTestSessions(runId);
/** Shaped like a Gemini key, and unique to this run, so a match can only be a leak. */
const CANARY = `AIzaCanary${randomBytes(14).toString('hex')}`;
const HOSTILE = new URL('../../fixtures/hostile/find-key.cjs', import.meta.url);

type Findings = {
  hits: { env: string[]; proc: string[]; files: string[] };
  scanned: { envVars: number; processes: number; files: number; bytes: number };
  network: Record<string, string>;
  dockerSocket: boolean;
};

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile());
}

describe.skipIf(!hasDocker)('the key canary', () => {
  beforeAll(() => sessions.prepare());
  afterAll(() => sessions.close());

  it('a hostile program in the sandbox finds no key and no way out', async () => {
    // Loaded as in CI: written to a one-time file by another step, read, then deleted at once.
    await mkdir(WORK_ROOT, { recursive: true });
    const keyFile = join(WORK_ROOT, `${runId}.key`);
    await writeFile(keyFile, CANARY, { mode: 0o600 });
    const key = await loadEvalKey({ kind: 'one-time-file', path: keyFile });
    expect(existsSync(keyFile)).toBe(false);

    const { call, doc } = await sessions.open();
    createFile(
      doc,
      { parentId: null, name: 'find-key.cjs', content: readFileSync(HOSTILE, 'utf8') },
      { userId: 'spec', userName: 'Spec' },
    );
    expect((await call({ name: 'run_project', input: {} })).ok).toBe(true);
    const result = await call({
      name: 'run_command',
      input: { command: 'node', args: ['find-key.cjs'] },
    });
    expect(result.output).toMatch(/^node find-key\.cjs exited with code 0/);
    const line = result.output.split('\n').find((candidate) => candidate.startsWith('{')) ?? '';
    const found = JSON.parse(line) as Findings;

    // It looked everywhere it could...
    expect(found.scanned.envVars).toBeGreaterThan(0);
    expect(found.scanned.processes).toBeGreaterThan(2);
    expect(found.scanned.files).toBeGreaterThan(1_000);
    // ...and found no key: nothing key-shaped from this run anywhere in the sandbox.
    const everything = [...found.hits.env, ...found.hits.proc, ...found.hits.files];
    expect(everything.filter((hit) => hit.startsWith('AIzaCanary'))).toEqual([]);
    expect(JSON.stringify(found)).not.toContain(CANARY);
    expect(result.output).not.toContain(CANARY);
    // No way out: no name lookup, no internet, no Docker daemon, no host, no Docker socket.
    expect(found.network['dns']).not.toBe('resolved');
    for (const target of ['internet', 'dockerHost', 'hostGateway']) {
      expect(found.network[target]).not.toBe('connected');
    }
    expect(found.dockerSocket).toBe(false);

    // Nor is it in this process's environment, as the OS shows it to other processes.
    expect(Object.values(process.env).some((value) => value?.includes(CANARY))).toBe(false);
    if (existsSync('/proc/self/environ')) {
      expect(readFileSync('/proc/self/environ', 'latin1')).not.toContain(CANARY);
    }
    // Nor in anything the run wrote.
    for (const path of filesUnder(join(WORK_ROOT, runId))) {
      expect(readFileSync(path, 'latin1'), path).not.toContain(CANARY);
    }
    // All of this happened while the key was live in memory.
    expect(key.reveal()).toBe(CANARY);
  }, 180_000);
});
