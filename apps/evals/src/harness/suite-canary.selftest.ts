/**
 * The key canary for a whole eval run (docs/decisions/010-evals.md): a canary
 * key, loaded exactly as CI loads the real one, goes through the real eval
 * model client to a gateway that records it; the run's traces, results,
 * report and everything printed must not contain it anywhere. (The sandbox's
 * side, a hostile program looking for it, is sandbox-canary.docker.test.ts.)
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ScriptEntry } from '@collabcode/agent';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeGateway, type FakeAnswer } from '../model/fake-gateway.js';
import { createGatewayModelClient } from '../model/gateway-model-client.js';
import { createPacer } from '../model/pacer.js';
import { RequestLedger } from '../model/request-ledger.js';
import { reportMarkdown } from '../results/report.js';
import { bakedDependencies, ensureSandboxImage } from '../sandbox/image.js';
import { WORK_ROOT } from '../sandbox/project-dir.js';
import { SessionContainer } from '../sandbox/session-container.js';
import { dockerForSpecs } from '../sandbox/test-session.js';
import { loadEvalKey } from '../secrets/eval-key.js';
import { TASKS } from '../tasks/index.js';
import { referenceScript } from '../tasks/reference-session.js';
import { nodeClock } from './node-clock.js';
import { runSuite } from './run-suite.js';

const hasDocker = await dockerForSpecs();
const runId = `suite-canary-${Date.now().toString(36)}`;
const CANARY = `AIzaCanary${randomBytes(14).toString('hex')}`;

function answersOf(script: readonly ScriptEntry[]): FakeAnswer[] {
  return script.map((entry) => {
    if (typeof entry === 'function' || 'error' in entry)
      throw new Error('reference scripts are plain answers');
    return { kind: 'answer', message: entry.message };
  });
}

describe.skipIf(!hasDocker)('the key canary, for a whole run', () => {
  const printed: string[] = [];
  beforeAll(() => {
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);
      vi.spyOn(stream, 'write').mockImplementation(
        (chunk: string | Uint8Array, ...rest: unknown[]) => {
          printed.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
          return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
        },
      );
    }
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '));
      });
    }
  });
  afterEach(() => undefined);
  afterAll(async () => {
    vi.restoreAllMocks();
    await SessionContainer.removeRun(runId);
    await rm(resolve(WORK_ROOT, runId), { recursive: true, force: true });
  });

  it('holds the key, sends it only to the provider, and writes and prints it nowhere', async () => {
    await mkdir(resolve(WORK_ROOT, runId), { recursive: true });
    const keyFile = resolve(WORK_ROOT, runId, 'key');
    await writeFile(keyFile, CANARY, { mode: 0o600 });
    const key = await loadEvalKey({ kind: 'one-time-file', path: keyFile });
    expect(existsSync(keyFile)).toBe(false);

    const tasks = TASKS.filter((task) =>
      ['delete-user', 'no-sandbox-discovered'].includes(task.id),
    );
    const answers: FakeAnswer[] = [];
    for (const task of tasks) answers.push(...answersOf(await referenceScript(task)));
    const gateway = createFakeGateway(answers);
    const ledger = await RequestLedger.open(resolve(WORK_ROOT, runId, 'usage.json'));
    const runDir = resolve(WORK_ROOT, runId, 'run');
    const lines: string[] = [];

    const results = await runSuite({
      tasks,
      trials: 1,
      runId,
      model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
      modelClient: createGatewayModelClient({
        gateway,
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        key,
        tier: 'shared',
        pacer: createPacer(1_000, nodeClock),
        ledger,
        dailyLimit: 1_000,
      }),
      prompt: 'agent@3',
      tier: 'shared',
      image: await ensureSandboxImage(),
      baked: await bakedDependencies(),
      clock: nodeClock,
      commit: 'canary',
      local: true,
      runDir,
      resume: null,
      mayStart: () => null,
      log: (line) => lines.push(line),
    });

    // The run happened, with the key live in every request...
    expect(results.results.map((result) => [result.task, result.passed])).toEqual([
      ['delete-user', true],
      ['no-sandbox-discovered', true],
    ]);
    expect(gateway.calls.length).toBeGreaterThan(3);
    expect(gateway.calls.every((call) => call.target.apiKey === CANARY)).toBe(true);

    // ...and it is in nothing the run wrote or printed.
    const written = readdirSync(runDir).map((name) => readFileSync(join(runDir, name), 'utf8'));
    expect(written.length).toBe(3);
    const everything = [
      ...written,
      JSON.stringify(results),
      reportMarkdown(results),
      ...lines,
      ...printed,
      readFileSync(resolve(WORK_ROOT, runId, 'usage.json'), 'utf8'),
    ];
    for (const text of everything) expect(text).not.toContain(CANARY);
    expect(Object.values(process.env).some((value) => value?.includes(CANARY))).toBe(false);
  });
});
