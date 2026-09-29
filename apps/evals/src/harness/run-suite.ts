/**
 * An eval run: the chosen tasks, one session each per trial, in order, each
 * graded as it ends. Results and traces are written after every session to
 * apps/evals/runs/<run id>, so a run cut short (the day's request limit, a
 * crash) resumes where it stopped with --resume, which is how a comparison on
 * a model with a small daily allowance spreads over several days.
 *
 * Before each session it asks whether one may start: a session can take up
 * to its tier's steps plus retries, and starting one the day cannot pay for
 * would only waste the requests it did make.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock, ModelClient } from '@collabcode/agent';
import type { AgentTier } from '@collabcode/shared';
import { GRADERS } from '../graders/version.js';
import { metricsOf } from '../results/metrics.js';
import type { RunResults, TaskResult } from '../results/run-results.js';
import type { TaskDefinition } from '../tasks/task.js';
import { runTask } from './run-task.js';

export type SuiteOptions = {
  tasks: readonly TaskDefinition[];
  trials: number;
  runId: string;
  model: { provider: string; id: string };
  modelClient: ModelClient;
  prompt: string;
  tier: AgentTier;
  image: string;
  baked: ReadonlySet<string>;
  clock: Clock;
  commit: string;
  local: boolean;
  /** apps/evals/runs/<run id>: traces and the results so far. */
  runDir: string;
  /** The results of the run being resumed, or null for a new run. */
  resume: RunResults | null;
  /** Null when a session may start, or why the run must stop. */
  mayStart: () => string | null;
  log: (line: string) => void;
};

export const RESULTS_FILE = 'results.json';
/** apps/evals/runs: each run's traces and results so far, git-ignored. */
export const RUNS_DIR = fileURLToPath(new URL('../../runs/', import.meta.url));

export async function runSuite(options: SuiteOptions): Promise<RunResults> {
  const { tasks, trials, runDir, log } = options;
  await mkdir(runDir, { recursive: true });
  const results: TaskResult[] = [...(options.resume?.results ?? [])];
  const done = new Set(results.map((result) => `${result.task}#${String(result.trial)}`));
  const run: RunResults['run'] = options.resume?.run ?? {
    id: options.runId,
    startedAt: new Date(options.clock.now()).toISOString(),
    finishedAt: null,
    commit: options.commit,
    model: options.model,
    prompt: options.prompt,
    graders: GRADERS,
    regraded: null,
    tier: options.tier,
    trials,
    tasks: tasks.map((task) => task.id),
    local: options.local,
    stoppedEarly: null,
  };
  const save = async (stoppedEarly: string | null, finished: boolean): Promise<RunResults> => {
    const current: RunResults = {
      format: 'collabcode-eval-results',
      version: 1,
      run: {
        ...run,
        stoppedEarly,
        finishedAt: finished ? new Date(options.clock.now()).toISOString() : null,
      },
      results,
    };
    await writeFile(join(runDir, RESULTS_FILE), `${JSON.stringify(current, null, 2)}\n`);
    return current;
  };

  for (let trial = 1; trial <= trials; trial += 1) {
    for (const task of tasks) {
      if (done.has(`${task.id}#${String(trial)}`)) continue;
      const stop = options.mayStart();
      if (stop !== null) {
        log(`Stopping before ${task.id}: ${stop}`);
        return save(stop, false);
      }
      log(`${task.id}${trials > 1 ? ` (trial ${String(trial)})` : ''}: ${task.title}`);
      const outcome = await runTask({
        task,
        runId: options.runId,
        model: options.modelClient,
        image: options.image,
        baked: options.baked,
        clock: options.clock,
        tier: options.tier,
      });
      const traceFile = `${task.id}-${String(trial)}.trace.json`;
      await writeFile(join(runDir, traceFile), `${JSON.stringify(outcome.trace, null, 2)}\n`);
      const result: TaskResult = {
        task: task.id,
        title: task.title,
        trial,
        passed: outcome.passed,
        category: outcome.category,
        grades: outcome.grades,
        outcome: outcome.trace.outcome?.kind ?? 'none',
        metrics: metricsOf(outcome.trace),
        trace: traceFile,
      };
      results.push(result);
      done.add(`${task.id}#${String(trial)}`);
      const failed = outcome.grades.find((grade) => !grade.passed);
      log(
        `  ${outcome.passed ? 'pass' : `fail (${String(outcome.category)}: ${failed?.id ?? ''}: ${failed?.detail ?? ''})`} · ${String(result.metrics.steps)} steps · ${String(result.metrics.requests)} requests`,
      );
      await save(null, false);
    }
  }
  return save(null, true);
}
