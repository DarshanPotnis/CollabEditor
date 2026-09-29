/**
 * A finished run graded again from its saved traces by today's graders,
 * without running anything or asking a model (npm run evals:regrade).
 *
 * Only graders that read the trace alone can judge again. The ones that
 * needed the project (its files, or a sandbox running it) keep the verdict
 * they gave while the run was on, so a re-grade refuses a task that has
 * gained one of those. The results then record the graders version that
 * judged them, what judged them before, and which verdicts changed. Each
 * session's measures are worked out from its trace again as well, so a run
 * recorded before a measure existed gains it.
 */
import type { AgentTrace } from '@collabcode/agent';
import type { GraderResult } from '../graders/grader.js';
import { categorize, graderResult } from '../graders/grading.js';
import { GRADERS } from '../graders/version.js';
import type { TaskDefinition } from '../tasks/task.js';
import { metricsOf } from './metrics.js';
import type { Regraded, RunResults, TaskResult } from './run-results.js';

export class RegradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegradeError';
  }
}

export type RegradeOptions = {
  results: RunResults;
  tasks: readonly TaskDefinition[];
  /** The saved trace that a result names. */
  trace: (file: string) => AgentTrace;
  /** The commit whose graders judge it now. */
  commit: string;
  now: Date;
};

function gradesAgain(result: TaskResult, task: TaskDefinition, trace: AgentTrace): GraderResult[] {
  return task.graders.map((grader) => {
    if (grader.reads === 'project') {
      const kept = result.grades.find((grade) => grade.id === grader.id);
      if (!kept) {
        throw new RegradeError(
          `${result.task}: ${grader.id} needs the project, which a re-grade cannot run, and the run has no verdict from it.`,
        );
      }
      return kept;
    }
    try {
      return graderResult(grader, grader.grade({ trace }));
    } catch (error) {
      // As in a run: a grader that breaks fails its session, and says so.
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: grader.id,
        passed: false,
        detail: `the grader broke: ${message}`,
        category: 'harness-error',
      };
    }
  });
}

export function regrade(options: RegradeOptions): RunResults {
  const { results, tasks } = options;
  const { run } = results;
  if (run.finishedAt === null) {
    throw new RegradeError(`Run ${run.id} has not finished; resume it before grading it again.`);
  }
  const changes: Regraded['changes'] = [];
  const graded = results.results.map((result): TaskResult => {
    const task = tasks.find((candidate) => candidate.id === result.task);
    if (!task)
      throw new RegradeError(`Run ${run.id} has task ${result.task}, which no longer exists.`);
    const trace = options.trace(result.trace);
    const grades = gradesAgain(result, task, trace);
    const category = categorize(trace, grades);
    const after = { passed: category === null, category };
    if (after.passed !== result.passed || after.category !== result.category) {
      changes.push({
        task: result.task,
        trial: result.trial,
        before: { passed: result.passed, category: result.category },
        after,
      });
    }
    // Measures are the trace's too: a run gains any added since it was recorded.
    return { ...result, ...after, grades, metrics: metricsOf(trace) };
  });
  // The same graders changing nothing: the note of how the verdicts came about still holds.
  const unchanged = run.graders === GRADERS && changes.length === 0;
  return {
    ...results,
    run: {
      ...run,
      graders: GRADERS,
      regraded:
        unchanged && run.regraded !== null
          ? run.regraded
          : { from: run.graders, commit: options.commit, at: options.now.toISOString(), changes },
    },
    results: graded,
  };
}
