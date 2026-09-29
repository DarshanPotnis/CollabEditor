import { describe, expect, it } from 'vitest';
import { CompareError, compareRuns } from './compare.js';
import { runResultsSchema, type RunResults, type TaskResult } from './run-results.js';

function result(
  task: string,
  category: TaskResult['category'],
  steps = 4,
  extra: Partial<TaskResult['metrics']> = {},
): TaskResult {
  return {
    task,
    title: `Task ${task}`,
    trial: 1,
    passed: category === null,
    category,
    grades: [],
    outcome: 'finished',
    metrics: {
      steps,
      requests: steps,
      inputTokens: 1_000 * steps,
      outputTokens: 0,
      wallMs: 10_000,
      modelMs: 0,
      toolMs: 0,
      waitMs: 0,
      wastedSteps: 0,
      repeatedErrors: 0,
      refusedFinishes: 0,
      checksNotMade: 0,
      ...extra,
    },
    trace: `${task}-1.trace.json`,
  };
}

function run(id: string, prompt: string, results: TaskResult[], graders = 'graders@2'): RunResults {
  return runResultsSchema.parse({
    format: 'collabcode-eval-results',
    version: 1,
    run: {
      id,
      startedAt: '2026-09-29T10:00:00.000Z',
      finishedAt: '2026-09-29T10:30:00.000Z',
      commit: id.slice(-7),
      model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
      prompt,
      graders,
      tier: 'shared',
      trials: 1,
      tasks: results.map((entry) => entry.task),
      local: false,
      stoppedEarly: null,
    },
    results,
  });
}

const baseline = run('base-aaaaaaa', 'agent@3', [
  result('a', null),
  result('b', 'unverified'),
  result('c', 'ran-out', 15, { repeatedErrors: 4 }),
]);
const again = run('again-bbbbbbb', 'agent@3', [
  result('a', null),
  result('b', 'unverified'),
  result('c', null, 6),
]);
const next = run('next-ccccccc', 'agent@4', [
  result('a', null, 5),
  result('b', null, 5, { refusedFinishes: 1 }),
  result('c', 'wrong-result', 7),
  result('d', null),
]);

describe('compareRuns', () => {
  const report = compareRuns([baseline, again, next]);

  it('names each run by a letter, with what ran and what judged it', () => {
    expect(report).toContain(
      '| A | base-aaaaaaa | gemini-3.5-flash-lite | agent@3 | graders@2 | aaaaaaa |',
    );
    expect(report).toContain(
      '| C | next-ccccccc | gemini-3.5-flash-lite | agent@4 | graders@2 | ccccccc |',
    );
  });

  it('puts the numbers side by side, over the tasks every run has', () => {
    expect(report).toContain('| Passed | 1 of 3 (33%) | 2 of 3 (67%) | 2 of 3 (67%) |');
    expect(report).toContain(
      '| Tasks passed every time · some · never | 1 · 0 · 2 | 2 · 0 · 1 | 2 · 0 · 1 |',
    );
    expect(report).toContain('| Repeated errors per session | 1.3 | 0.0 | 0.0 |');
    expect(report).toContain('| Refused finishes per session | 0.0 | 0.0 | 0.3 |');
    expect(report).toContain('Left out, not in every run: d.');
  });

  it('counts failure categories side by side', () => {
    expect(report).toContain('| unverified | 1 | 1 | 0 |');
    expect(report).toContain('| ran-out | 1 | 0 | 0 |');
    expect(report).toContain('| wrong-result | 0 | 0 | 1 |');
  });

  it('shows each task in every run, and which runs differ from A', () => {
    expect(report).toContain('| Task a | pass | pass | pass |  |');
    expect(report).toContain('| Task b | fail (unverified) | fail (unverified) | pass | C |');
    expect(report).toContain('| Task c | fail (ran-out) | pass | fail (wrong-result) | B, C |');
  });

  it('shows a dash for what a run recorded before it was measured', () => {
    const { refusedFinishes: _a, checksNotMade: _b, ...older } = result('a', null).metrics;
    const unmeasured = run('old-eeeeeee', 'agent@3', [{ ...result('a', null), metrics: older }]);
    const lines = compareRuns([unmeasured, next]);
    expect(lines).toContain('| Refused finishes per session | — | 0.0 |');
    expect(lines).toContain('| Checks listed but not made | — | 0 |');
    expect(lines).toContain('| Checks after the last change per session | — | — |');
  });

  it('refuses runs judged by different graders, and fewer than two', () => {
    const older = run('old-ddddddd', 'agent@3', [result('a', null)], 'graders@1');
    expect(() => compareRuns([older, next])).toThrow(CompareError);
    expect(() => compareRuns([older, next])).toThrow(/npm run evals:regrade/);
    expect(() => compareRuns([next])).toThrow('Compare at least two runs.');
  });
});
