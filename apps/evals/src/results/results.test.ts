import type { AgentTrace } from '@collabcode/agent';
import { REPEATED_ERROR_REMINDER } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import { metricsOf } from './metrics.js';
import { README_END, README_START, latestRuns, readmeTable, withTable } from './readme.js';
import { reportMarkdown } from './report.js';
import { runResultsSchema, summarize, type RunResults, type TaskResult } from './run-results.js';

type Step = AgentTrace['steps'][number];

function step(overrides: Partial<Step>): Step {
  return {
    index: 1,
    startedAtMs: 0,
    waits: [],
    model: {
      provider: 'gemini',
      id: 'm',
      durationMs: 1_000,
      finishReason: 'tool-calls',
      rawFinishReason: 'STOP',
      usage: { inputTokens: 100, outputTokens: 10 },
      message: { role: 'assistant', parts: [] },
    },
    toolCalls: [],
    nudged: false,
    reminder: null,
    ...overrides,
  };
}

const ok = {
  toolCallId: 'c',
  toolName: 'read_file',
  input: {},
  isError: false,
  output: '',
  startedAtMs: 0,
  durationMs: 200,
};
const failed = { ...ok, toolName: 'edit_file', isError: true, durationMs: 5 };

describe('metricsOf', () => {
  it('counts every attempt as a request, and the steps that achieved nothing', () => {
    const trace = {
      steps: [
        step({ toolCalls: [ok], waits: [{ reason: 'busy', waitMs: 5_000, attemptMs: 80 }] }),
        step({ toolCalls: [failed] }),
        step({ toolCalls: [failed, ok], reminder: REPEATED_ERROR_REMINDER }),
        step({ toolCalls: [] }),
      ],
      totals: { steps: 4, inputTokens: 400, outputTokens: 40, durationMs: 12_000 },
    } as unknown as AgentTrace;
    expect(metricsOf(trace)).toEqual({
      steps: 4,
      requests: 5,
      inputTokens: 400,
      outputTokens: 40,
      wallMs: 12_000,
      modelMs: 4_000,
      toolMs: 410,
      waitMs: 5_000,
      wastedSteps: 2,
      repeatedErrors: 1,
    });
  });
});

function result(
  task: string,
  passed: boolean,
  steps: number,
  category: TaskResult['category'] = null,
): TaskResult {
  return {
    task,
    title: `Task ${task}`,
    trial: 1,
    passed,
    category,
    grades: passed
      ? [
          {
            id: 'behaves',
            passed: true,
            detail: '2 hidden checks passed',
            category: 'wrong-result',
          },
        ]
      : [
          {
            id: 'behaves',
            passed: false,
            detail: 'DELETE /users/abc: expected 400, got 404 | pipe',
            category: 'wrong-result',
          },
        ],
    outcome: 'finished',
    metrics: {
      steps,
      requests: steps + 1,
      inputTokens: 1_000 * steps,
      outputTokens: 50,
      wallMs: 10_000,
      modelMs: 5_000,
      toolMs: 1_000,
      waitMs: 0,
      wastedSteps: passed ? 0 : 2,
      repeatedErrors: 0,
    },
    trace: `${task}-1.trace.json`,
  };
}

function run(id: string, model: string, startedAt: string, results: TaskResult[]): RunResults {
  return runResultsSchema.parse({
    format: 'collabcode-eval-results',
    version: 1,
    run: {
      id,
      startedAt,
      finishedAt: startedAt,
      commit: 'abc1234',
      model: { provider: 'gemini', id: model },
      prompt: 'agent@3',
      tier: 'shared',
      trials: 1,
      tasks: results.map((entry) => entry.task),
      local: false,
      stoppedEarly: null,
    },
    results,
  });
}

describe('a run summary and its report', () => {
  const results = [
    result('a', true, 5),
    result('b', false, 9, 'wrong-result'),
    result('c', true, 7),
  ];

  it('summarizes pass rate, median steps and costs per task', () => {
    expect(summarize(results)).toMatchObject({
      tasks: 3,
      passed: 2,
      medianSteps: 7,
      requestsPerTask: 8,
      categories: { 'wrong-result': 1 },
    });
  });

  it('reports each task with why it failed, keeping the table intact', () => {
    const report = reportMarkdown(
      run('r1', 'gemini-3.5-flash-lite', '2026-09-30T10:00:00.000Z', results),
    );
    expect(report).toContain('**2 of 3 passed (67%)**');
    expect(report).toContain(
      '| Task b | fail | 9 | 2 | 10 | 9,050 | 10.0 s | wrong-result: behaves: DELETE /users/abc: expected 400, got 404 \\| pipe |',
    );
    expect(report).toContain('- wrong-result: 1');
    expect(report).toContain('gemini/gemini-3.5-flash-lite · agent@3 · graders@1 · shared tier');
  });

  it('says when a run was graded again, and which verdicts changed', () => {
    const graded = run('r1', 'gemini-3.5-flash-lite', '2026-09-30T10:00:00.000Z', results);
    const report = reportMarkdown({
      ...graded,
      run: {
        ...graded.run,
        graders: 'graders@2',
        regraded: {
          from: 'graders@1',
          commit: 'def5678',
          at: '2026-10-01T09:00:00.000Z',
          changes: [
            {
              task: 'b',
              trial: 1,
              before: { passed: true, category: null },
              after: { passed: false, category: 'dishonest' },
            },
          ],
        },
      },
    });
    expect(report).toContain(
      'Graded again with graders@2 at commit def5678 on 2026-10-01, from the saved traces; it ran at commit abc1234 and was first graded with graders@1. 1 verdict changed:\n\n- Task b: pass → fail (dishonest)',
    );
  });
});

describe('the README table', () => {
  it('shows the latest run for each model and task count, and replaces only its section', () => {
    const old = run('old', 'gemini-3.5-flash-lite', '2026-09-29T10:00:00.000Z', [
      result('a', false, 3, 'ran-out'),
    ]);
    const newer = run('new', 'gemini-3.5-flash-lite', '2026-09-30T10:00:00.000Z', [
      result('a', true, 3),
    ]);
    const flash = run('flash', 'gemini-3.8-flash', '2026-09-30T09:00:00.000Z', [
      result('a', true, 4),
    ]);
    expect(latestRuns([old, newer, flash]).map((entry) => entry.run.id)).toEqual(['new', 'flash']);
    const table = readmeTable([old, newer, flash]);
    expect(table.split('\n')).toHaveLength(4);
    expect(table).toContain(
      '| gemini-3.5-flash-lite | 2026-09-30 | agent@3 | graders@1 | 1 of 1 |',
    );
    const readme = `# App\n\n${README_START}\nstale\n${README_END}\n\nMore.`;
    expect(withTable(readme, table)).toBe(
      `# App\n\n${README_START}\n\n${table}\n\n${README_END}\n\nMore.`,
    );
    expect(readmeTable([])).toBe('No eval run is recorded yet.');
  });
});
