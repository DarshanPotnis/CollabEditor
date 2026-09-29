/**
 * Which sessions a run still has to play. A new run plays every task for each
 * trial in turn. A resumed run skips the sessions that have a verdict, and
 * plays again the ones the model never answered (model-unavailable: busy or
 * rate-limited), since those measured nothing about the agent. The day's
 * request budget still decides how many start (run-suite.ts).
 */
import type { TaskResult } from '../results/run-results.js';

const key = (task: string, trial: number): string => `${task}#${String(trial)}`;

export function pendingSessions<Task extends { id: string }>(
  tasks: readonly Task[],
  trials: number,
  results: readonly TaskResult[],
): Array<{ task: Task; trial: number }> {
  const judged = new Set(
    results
      .filter((result) => result.category !== 'model-unavailable')
      .map((result) => key(result.task, result.trial)),
  );
  const pending: Array<{ task: Task; trial: number }> = [];
  for (let trial = 1; trial <= trials; trial += 1) {
    for (const task of tasks) {
      if (!judged.has(key(task.id, trial))) pending.push({ task, trial });
    }
  }
  return pending;
}

/** The results with `result` in place of the same session's earlier one, or added at the end. */
export function withResult(results: readonly TaskResult[], result: TaskResult): TaskResult[] {
  const at = results.findIndex(
    (earlier) => earlier.task === result.task && earlier.trial === result.trial,
  );
  return at === -1 ? [...results, result] : results.with(at, result);
}
