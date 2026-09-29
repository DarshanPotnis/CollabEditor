/**
 * The graders' test: each task's reference session, played by a scripted
 * model through the real harness and Docker sandbox, passes every grader; and
 * each known-bad session fails the grader it names. A grader that cannot
 * fail, or that fails a good solution, shows up here, before any model is
 * judged by it. Needs Docker (CI requires it: REQUIRE_DOCKER=1).
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createScriptedModel } from '@collabcode/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeClock } from '../harness/node-clock.js';
import { runTask } from '../harness/run-task.js';
import { bakedDependencies, ensureSandboxImage } from '../sandbox/image.js';
import { WORK_ROOT } from '../sandbox/project-dir.js';
import { SessionContainer } from '../sandbox/session-container.js';
import { dockerForSpecs } from '../sandbox/test-session.js';
import { TASKS } from './index.js';
import { referenceScript } from './reference-session.js';
import type { KnownBadVariant, TaskDefinition } from './task.js';

const hasDocker = await dockerForSpecs();
const runId = `selftest-${Date.now().toString(36)}`;
let image = '';
let baked: ReadonlySet<string> = new Set();

async function play(task: TaskDefinition, variant?: KnownBadVariant) {
  return runTask({
    task,
    runId,
    model: createScriptedModel(await referenceScript(task, variant)),
    image,
    baked,
    clock: nodeClock,
    tier: 'shared',
  });
}

describe.skipIf(!hasDocker)('every task grades its reference and its known-bad sessions', () => {
  beforeAll(async () => {
    image = await ensureSandboxImage();
    baked = await bakedDependencies();
  });
  afterAll(async () => {
    await SessionContainer.removeRun(runId);
    await rm(resolve(WORK_ROOT, runId), { recursive: true, force: true });
  });

  for (const task of TASKS) {
    it(`${task.id}: the reference passes every grader`, async () => {
      const run = await play(task);
      expect(run.grades.filter((grade) => !grade.passed)).toEqual([]);
      expect(run.passed).toBe(true);
    });

    for (const bad of task.knownBad) {
      it(`${task.id}: "${bad.name}" fails ${bad.fails}`, async () => {
        const run = await play(task, bad.variant);
        const grade = run.grades.find((candidate) => candidate.id === bad.fails);
        expect(grade?.passed, grade?.detail).toBe(false);
        // Failing because the grader broke would prove nothing.
        expect(grade?.category, grade?.detail).not.toBe('harness-error');
        expect(run.passed).toBe(false);
      });
    }
  }
});
