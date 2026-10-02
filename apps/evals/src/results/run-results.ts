/**
 * An eval run's results, as written to docs/evals/results/*.json: what ran
 * (model, prompt version, graders version, tier, commit), each task's verdict with every
 * grader's reason and its metrics, and a summary. Traces are not in here:
 * they stay in apps/evals/runs (git-ignored) and CI artifacts, and results
 * name them. Nothing here ever holds the key.
 */
import { z } from 'zod';
import { FAILURE_CATEGORIES } from '../graders/grader.js';
import type { TaskMetrics } from './metrics.js';

const metricsSchema = z.object({
  steps: z.number(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  wallMs: z.number(),
  modelMs: z.number(),
  toolMs: z.number(),
  waitMs: z.number(),
  wastedSteps: z.number(),
  repeatedErrors: z.number(),
  /** Absent from results recorded before they were measured. */
  refusedFinishes: z.number().optional(),
  checksNotMade: z.number().optional(),
  checksAfterLastChange: z.number().optional(),
}) satisfies z.ZodType<TaskMetrics>;

export const taskResultSchema = z.object({
  task: z.string(),
  title: z.string(),
  trial: z.number().int().positive(),
  passed: z.boolean(),
  category: z.enum(FAILURE_CATEGORIES).nullable(),
  grades: z.array(
    z.object({
      id: z.string(),
      passed: z.boolean(),
      detail: z.string(),
      category: z.enum(FAILURE_CATEGORIES),
    }),
  ),
  outcome: z.string(),
  metrics: metricsSchema,
  /** The trace file, relative to the run's folder. */
  trace: z.string(),
});
export type TaskResult = z.infer<typeof taskResultSchema>;

const verdictSchema = z.object({
  passed: z.boolean(),
  category: z.enum(FAILURE_CATEGORIES).nullable(),
});

/** A run graded again from its traces, with later graders (results/regrade.ts). */
export const regradedSchema = z.object({
  /** The graders that judged it before. */
  from: z.string(),
  /** The commit whose graders judged it now. */
  commit: z.string(),
  at: z.string(),
  /** The sessions whose verdict changed. */
  changes: z.array(
    z.object({
      task: z.string(),
      trial: z.number().int().positive(),
      before: verdictSchema,
      after: verdictSchema,
    }),
  ),
});
export type Regraded = z.infer<typeof regradedSchema>;

export const runResultsSchema = z.object({
  format: z.literal('collabcode-eval-results'),
  version: z.literal(1),
  run: z.object({
    id: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    commit: z.string(),
    model: z.object({ provider: z.string(), id: z.string() }),
    prompt: z.string(),
    /** What judged it (graders/version.ts). Results from before this was recorded had the first. */
    graders: z.string().default('graders@1'),
    /** Set when the run was graded again, after it ran. */
    regraded: regradedSchema.nullable().default(null),
    tier: z.enum(['shared', 'ownKey']),
    trials: z.number().int().positive(),
    tasks: z.array(z.string()),
    /** False for a run in CI; true for one on someone's machine. */
    local: z.boolean(),
    /** Set when the run stopped early, for example at the day's request limit. */
    stoppedEarly: z.string().nullable(),
  }),
  results: z.array(taskResultSchema),
});
export type RunResults = z.infer<typeof runResultsSchema>;

export type RunSummary = {
  /** One per task per trial. */
  sessions: number;
  passed: number;
  passRate: number;
  /**
   * Tasks passed in every one of their sessions, in some, and in none; and each
   * task's passes out of its answered sessions, in the order tasks first appear.
   */
  byTask: {
    tasks: number;
    every: number;
    some: number;
    none: number;
    perTask: Array<{ task: string; passed: number; sessions: number }>;
  };
  /** Null when a session was recorded before this was measured. */
  checksAfterLastChangePerTask: number | null;
  /** Sessions the model never answered: left out of everything above, as not the agent's failure. */
  unavailable: Array<{ task: string; trial: number }>;
  medianSteps: number;
  wastedStepsPerTask: number;
  requestsPerTask: number;
  tokensPerTask: number;
  wallSecondsPerTask: number;
  categories: Partial<Record<(typeof FAILURE_CATEGORIES)[number], number>>;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

/** A session the model never answered measured nothing about the agent. */
export const unanswered = (result: TaskResult): boolean => result.category === 'model-unavailable';

export function summarize(all: readonly TaskResult[]): RunSummary {
  const results = all.filter((result) => !unanswered(result));
  const categories: RunSummary['categories'] = {};
  for (const result of results) {
    if (result.category !== null)
      categories[result.category] = (categories[result.category] ?? 0) + 1;
  }
  const passed = results.filter((result) => result.passed).length;
  const passes = new Map<string, boolean[]>();
  for (const result of results) {
    passes.set(result.task, [...(passes.get(result.task) ?? []), result.passed]);
  }
  const perTask = [...passes.values()];
  const checks = results.map((result) => result.metrics.checksAfterLastChange);
  return {
    sessions: results.length,
    passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    byTask: {
      tasks: perTask.length,
      every: perTask.filter((each) => each.every(Boolean)).length,
      some: perTask.filter((each) => each.some(Boolean) && !each.every(Boolean)).length,
      none: perTask.filter((each) => !each.some(Boolean)).length,
      perTask: [...passes].map(([task, each]) => ({
        task,
        passed: each.filter(Boolean).length,
        sessions: each.length,
      })),
    },
    checksAfterLastChangePerTask: checks.every((value) => value !== undefined)
      ? mean(checks)
      : null,
    medianSteps: median(results.map((result) => result.metrics.steps)),
    wastedStepsPerTask: mean(results.map((result) => result.metrics.wastedSteps)),
    requestsPerTask: mean(results.map((result) => result.metrics.requests)),
    tokensPerTask: mean(
      results.map((result) => result.metrics.inputTokens + result.metrics.outputTokens),
    ),
    wallSecondsPerTask: mean(results.map((result) => result.metrics.wallMs / 1000)),
    categories,
    unavailable: all
      .filter(unanswered)
      .map((result) => ({ task: result.task, trial: result.trial })),
  };
}
