import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { EvalKeyError, Secret, loadEvalKey, refuseKeyInEnvironment } from './eval-key.js';

const CANARY = 'eval-key-canary-7c1f';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fileWith(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eval-key-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, content, { mode: 0o600 });
  return path;
}

describe('the eval key', () => {
  it('is read from a one-time file, which is deleted at once', async () => {
    const path = await fileWith('key', `${CANARY}\n`);
    const key = await loadEvalKey({ kind: 'one-time-file', path }, {});
    expect(key.reveal()).toBe(CANARY);
    expect(existsSync(path)).toBe(false);
  });

  it('is read from apps/evals/.env, which stays', async () => {
    const path = await fileWith('.env', `# comment\nOTHER=1\nEVAL_GEMINI_API_KEY="${CANARY}"\n`);
    expect((await loadEvalKey({ kind: 'env-file', path }, {})).reveal()).toBe(CANARY);
    expect(existsSync(path)).toBe(true);
  });

  it('refuses to run with a key in the environment, under any of its names', async () => {
    for (const name of ['EVAL_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) {
      expect(() => refuseKeyInEnvironment({ [name]: CANARY })).toThrow(EvalKeyError);
    }
    const path = await fileWith('key', CANARY);
    await expect(
      loadEvalKey({ kind: 'one-time-file', path }, { EVAL_GEMINI_API_KEY: CANARY }),
    ).rejects.toThrow(/environment/);
    // Refused before it was read: the file is still there, and no message shows the key.
    expect(existsSync(path)).toBe(true);
    try {
      refuseKeyInEnvironment({ GEMINI_API_KEY: CANARY });
    } catch (error) {
      expect(String(error)).not.toContain(CANARY);
    }
  });

  it('says what is wrong with a missing or empty key, without a value', async () => {
    const empty = await fileWith('.env', 'EVAL_GEMINI_API_KEY=\n');
    await expect(loadEvalKey({ kind: 'env-file', path: empty }, {})).rejects.toThrow(
      /has no EVAL_GEMINI_API_KEY= line with a value/,
    );
    await expect(
      loadEvalKey({ kind: 'one-time-file', path: join(tmpdir(), 'no-such-key-file') }, {}),
    ).rejects.toThrow(/could not be read \(ENOENT\)/);
  });

  it('never prints itself: in strings, JSON, logs or errors', () => {
    const key = new Secret(CANARY);
    const shown = [
      String(key),
      key.toString(),
      JSON.stringify({ key }),
      inspect({ nested: { key } }),
      String(new Error('with '.concat(String(key)))),
    ];
    for (const text of shown) expect(text).not.toContain(CANARY);
  });
});
