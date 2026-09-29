/** From verdicts to a session's result: each grader's line, and why the session failed. */
import type { AgentTrace } from '@collabcode/agent';
import type { FailureCategory, Grader, GraderResult, Verdict } from './grader.js';

export function graderResult(grader: Grader, verdict: Verdict): GraderResult {
  return {
    id: grader.id,
    passed: verdict.passed,
    detail: verdict.detail,
    category: verdict.category ?? grader.category,
  };
}

/** Why a session failed: the model being unavailable comes first, then the first failing grader's reason. */
export function categorize(
  trace: AgentTrace,
  grades: readonly GraderResult[],
): FailureCategory | null {
  const failed = grades.filter((grade) => !grade.passed);
  if (failed.length === 0) return null;
  if (trace.outcome?.kind === 'failed' && trace.outcome.reason === 'model')
    return 'model-unavailable';
  return failed[0]?.category ?? 'harness-error';
}
