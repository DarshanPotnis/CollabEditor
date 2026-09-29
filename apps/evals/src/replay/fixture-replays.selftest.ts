/**
 * The recorded AI-2 sessions (packages/agent/fixtures/traces), replayed with
 * no model: their recorded answers go through today's tools, sandbox and
 * graders. Each pins
 *
 * - the graders' verdict and its category, so the graders are checked against
 *   real sessions: the loop that never finished must fail, the busy model
 *   must count as the model's failure, not the agent's;
 * - the tool results that now differ from the recording. When a tool change
 *   alters what a real session would have seen, this list changes and a person
 *   looks at why. (Replaying the loop without its recorded tool results, the
 *   exact replay, is packages/agent's fixture-traces.test.ts.)
 *
 * Free: no model, no key. Needs Docker (CI requires it: REQUIRE_DOCKER=1).
 */
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTrace, scriptFromTrace, type AgentTrace } from '@collabcode/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeClock } from '../harness/node-clock.js';
import { runTask } from '../harness/run-task.js';
import { bakedDependencies, ensureSandboxImage } from '../sandbox/image.js';
import { WORK_ROOT } from '../sandbox/project-dir.js';
import { SessionContainer } from '../sandbox/session-container.js';
import { dockerForSpecs } from '../sandbox/test-session.js';
import { TASKS } from '../tasks/index.js';
import { replayDifferences } from './replay-diff.js';

const hasDocker = await dockerForSpecs();
const runId = `replays-${Date.now().toString(36)}`;
const NO_SANDBOX_TEXT =
  "error: The sandbox isn't available in this session, so code can't run here.";
const STALE_TEXT = 'error: routes/users.js: The text to replace is not in the file. It may have';

function fixture(name: string): AgentTrace {
  const trace = parseTrace(
    JSON.parse(
      readFileSync(
        new URL(`../../../../packages/agent/fixtures/traces/${name}`, import.meta.url),
        'utf8',
      ),
    ),
  );
  if (!trace) throw new Error(`${name} is not a trace`);
  return trace;
}

type Expected = {
  fixture: string;
  task: string;
  category: string | null;
  failing: string[];
  /** Each difference as "step tool: recorded … → replayed …", both shortened. */
  differences: string[];
};

const short = (line: string): string => line.slice(0, 72);
const diff = (step: number, tool: string, recorded: string, replayed: string): string =>
  `${String(step)} ${tool}: ${short(recorded)} → ${short(replayed)}`;

const REPLAYS: Expected[] = [
  {
    fixture: 'successful-demo.json',
    task: 'delete-user',
    // It never checked a non-numeric id, the route's third answer, after its last edit.
    category: 'unverified',
    failing: ['verified'],
    differences: [
      diff(
        1,
        'edit_file',
        STALE_TEXT,
        'error: routes/users.js: The text to replace is not in the file. Lines 14–23 match',
      ),
      // Step 0's repair: the edits that kept the space after "N| " land now...
      diff(
        3,
        'edit_file',
        STALE_TEXT,
        'ok: Edited routes/users.js (changed lines 23–38). oldText started with a space',
      ),
      // ...so the requests in the same answer meet the new route...
      diff(3, 'http_request', 'ok: HTTP 404 Not Found, … ms', 'ok: HTTP 200 OK, … ms'),
      // ...and the later recorded edits, made to the file as it was then, add the route twice more.
      diff(
        4,
        'read_file',
        'ok: routes/users.js, lines 1–23 of 23:',
        'ok: routes/users.js, lines 1–25 of 38:',
      ),
      diff(
        5,
        'edit_file',
        STALE_TEXT,
        'ok: Edited routes/users.js (changed lines 23–39). oldText started with a space',
      ),
      diff(
        6,
        'read_file',
        'ok: routes/users.js, lines 14–23 of 23:',
        'ok: routes/users.js, lines 14–23 of 54:',
      ),
    ],
  },
  {
    fixture: 'runtime-unavailable-agent-loops.json',
    task: 'no-sandbox-discovered',
    category: 'ran-out',
    failing: ['finished', 'scope', 'stopped-running', 'says-untested'],
    // The run tools now say, every time, that there is no sandbox and not to try again.
    differences: [1, 2, 8, 10, 13, 14, 15].map(
      (step) =>
        `${String(step)} ${step === 1 ? 'run_project' : 'run_command'}: ${short(
          step === 1
            ? "error: The run failed: The runtime could not start (Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.)."
            : 'error: Start the project with run_project first, so there is a sandbox to run commands in.',
        )} → ${short(NO_SANDBOX_TEXT)}`,
    ),
  },
  {
    fixture: 'model-busy-mid-session.json',
    task: 'delete-user',
    // The model failed, not the agent: counted apart from the agent's own failures.
    category: 'model-unavailable',
    failing: ['finished', 'behaves', 'verified'],
    differences: [],
  },
];

describe.skipIf(!hasDocker)(
  'the recorded sessions, replayed through today’s tools and graders',
  () => {
    let image = '';
    let baked: ReadonlySet<string> = new Set();
    beforeAll(async () => {
      image = await ensureSandboxImage();
      baked = await bakedDependencies();
    });
    afterAll(async () => {
      await SessionContainer.removeRun(runId);
      await rm(resolve(WORK_ROOT, runId), { recursive: true, force: true });
    });

    for (const expected of REPLAYS) {
      it(`${expected.fixture}, as ${expected.task}: ${String(expected.category ?? 'passes')}`, async () => {
        const recorded = fixture(expected.fixture);
        const task = TASKS.find((candidate) => candidate.id === expected.task);
        if (!task) throw new Error(`no task ${expected.task}`);
        const run = await runTask({
          task,
          runId,
          model: scriptFromTrace(recorded),
          image,
          baked,
          clock: nodeClock,
          tier: 'shared',
        });
        expect(run.category).toBe(expected.category);
        expect(run.grades.filter((grade) => !grade.passed).map((grade) => grade.id)).toEqual(
          expected.failing,
        );
        expect(
          replayDifferences(recorded, run.trace).map(
            (difference) =>
              `${String(difference.step)} ${difference.tool}: ${short(difference.recorded)} → ${short(difference.replayed)}`,
          ),
        ).toEqual(expected.differences);
      });
    }
  },
);
