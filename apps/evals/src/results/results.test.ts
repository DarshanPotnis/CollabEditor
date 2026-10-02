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
      refusedFinishes: 0,
      checksNotMade: 0,
      checksAfterLastChange: 0,
    });
  });
});

describe('metricsOf, checks after the last change', () => {
  it('counts answered requests and commands that ran, after the last change only', () => {
    const call = (toolName: string, isError: boolean, output = '') => ({
      ...ok,
      toolName,
      isError,
      output,
    });
    const trace = {
      steps: [
        step({ toolCalls: [call('http_request', false, 'HTTP 200 OK, 3 ms')] }),
        step({ toolCalls: [call('edit_file', false)] }),
        step({ toolCalls: [call('edit_file', true)] }),
        step({
          toolCalls: [
            call('http_request', false, 'HTTP 404 Not Found, 3 ms'),
            call('http_request', true, 'The request failed: ECONNREFUSED'),
            call('run_command', true, 'npm test exited with code 1 after 1.0 s.\nfail'),
            call('run_command', true, 'Start the project with run_project first.'),
          ],
        }),
      ],
      totals: { steps: 4, inputTokens: 0, outputTokens: 0, durationMs: 0 },
    } as unknown as AgentTrace;
    expect(metricsOf(trace).checksAfterLastChange).toBe(2);
  });
});

describe('metricsOf, for agent@4', () => {
  it('counts refused finishes and the checks a finish listed but did not make', () => {
    const refused = { ...ok, toolName: 'finish', isError: true };
    const trace = {
      steps: [step({ toolCalls: [refused] }), step({ toolCalls: [{ ...ok, toolName: 'finish' }] })],
      outcome: {
        kind: 'finished',
        summary: 's',
        checks: {
          made: [],
          notMade: [
            {
              check: { kind: 'request', method: 'GET', path: '/', status: 200 },
              reason: 'not sent',
            },
          ],
        },
      },
      totals: { steps: 2, inputTokens: 0, outputTokens: 0, durationMs: 0 },
    } as unknown as AgentTrace;
    expect(metricsOf(trace)).toMatchObject({ refusedFinishes: 1, checksNotMade: 1 });
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
      refusedFinishes: 0,
      checksNotMade: 0,
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

  it('counts tasks passed in every session, some, or none, over several trials', () => {
    const trial = (entry: TaskResult, n: number): TaskResult => ({ ...entry, trial: n });
    const three = [1, 2, 3].flatMap((n) => [
      trial(result('a', true, 4), n),
      trial(n === 2 ? result('b', false, 4, 'unverified') : result('b', true, 4), n),
      trial(result('c', false, 4, 'ran-out'), n),
    ]);
    expect(summarize(three)).toMatchObject({
      sessions: 9,
      passed: 5,
      byTask: {
        tasks: 3,
        every: 1,
        some: 1,
        none: 1,
        perTask: [
          { task: 'a', passed: 3, sessions: 3 },
          { task: 'b', passed: 2, sessions: 3 },
          { task: 'c', passed: 0, sessions: 3 },
        ],
      },
    });
    const report = reportMarkdown({
      ...run('r3', 'gemini-3.5-flash-lite', '2026-09-30T10:00:00.000Z', three),
      run: { ...run('r3', 'm', '2026-09-30T10:00:00.000Z', three).run, trials: 3 },
    });
    expect(report).toContain(
      '**5 of 9 sessions passed (56%)** · every session passed on 1 of 3 tasks, some on 1, none on 1',
    );
    expect(report).toContain('| Task b | 2 of 3 | unverified |');
    expect(report).toContain('| Task c | 0 of 3 | ran-out, ran-out, ran-out |');
  });

  it('leaves out sessions the model never answered, and names them apart', () => {
    const sessions = [1, 2, 3].flatMap((n) => [
      { ...result('a', true, 4), trial: n },
      {
        ...(n === 2 ? result('b', false, 1, 'model-unavailable') : result('b', true, 4)),
        trial: n,
      },
    ]);
    expect(summarize(sessions)).toMatchObject({
      sessions: 5,
      passed: 5,
      byTask: {
        tasks: 2,
        every: 2,
        some: 0,
        none: 0,
        perTask: [
          { task: 'a', passed: 3, sessions: 3 },
          { task: 'b', passed: 2, sessions: 2 },
        ],
      },
      unavailable: [{ task: 'b', trial: 2 }],
      categories: {},
    });
    const three = run('r4', 'gemini-3.5-flash-lite', '2026-10-01T10:00:00.000Z', sessions);
    const report = reportMarkdown({ ...three, run: { ...three.run, trials: 3 } });
    expect(report).toContain(
      "Left out, the model never answered (not the agent's failure): Task b (trial 2).",
    );
  });

  it('summarizes pass rate, median steps and costs per task', () => {
    expect(summarize(results)).toMatchObject({
      sessions: 3,
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
      'Graded again with graders@2 at commit def5678 on 2026-10-01, from the saved traces; it ran at commit abc1234 and was last graded with graders@1. 1 verdict changed:\n\n- Task b: pass → fail (dishonest)',
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
    const agent4 = { ...newer, run: { ...newer.run, id: 'agent4', prompt: 'agent@4' } };
    expect(latestRuns([old, newer, agent4]).map((entry) => entry.run.id)).toEqual([
      'new',
      'agent4',
    ]);
    const table = readmeTable([old, newer, flash]);
    // No run with three sessions per task: no headline, and the single runs as what they are.
    expect(table).toContain('there is no headline pass rate');
    expect(table).toContain('**Iteration runs** (one session per task');
    expect(table).toContain(
      '| gemini-3.5-flash-lite | 2026-09-30 | agent@3 | graders@1 | 1 of 1 | — |',
    );
    const readme = `# App\n\n${README_START}\nstale\n${README_END}\n\nMore.`;
    expect(withTable(readme, table)).toBe(
      `# App\n\n${README_START}\n\n${table}\n\n${README_END}\n\nMore.`,
    );
    expect(readmeTable([])).toBe('No eval run is recorded yet.');
  });

  it('takes its headline from runs of three sessions per task, with how consistently each task passed', () => {
    const sessions = [1, 2, 3].flatMap((trial) => [
      { ...result('a', true, 4), trial },
      { ...(trial === 3 ? result('b', false, 4, 'unverified') : result('b', true, 4)), trial },
    ]);
    const three = run('three', 'gemini-3.5-flash-lite', '2026-10-01T10:00:00.000Z', sessions);
    const table = readmeTable([{ ...three, run: { ...three.run, trials: 3, tasks: ['a', 'b'] } }]);
    expect(table).toContain('Tasks passing 3 · 2 · 1 · 0 of 3 sessions');
    expect(table).toContain(
      '| gemini-3.5-flash-lite | agent@3 | graders@1 | 5 of 6 (83%) | 1 · 1 · 0 · 0 | — |',
    );
    // Task by task, folded away under the headline.
    expect(table).toContain('<summary>Sessions passed, task by task</summary>');
    expect(table).toContain('| Task | agent@3, graders@1 |');
    expect(table).toContain('| a | 3 of 3 |');
    expect(table).toContain('| b | 2 of 3 |');
    expect(table).not.toContain('Iteration runs');
    const busy = [
      ...sessions.slice(0, 5),
      { ...result('b', false, 1, 'model-unavailable'), trial: 3 },
    ];
    const withBusy = run('busy', 'gemini-3.5-flash-lite', '2026-10-02T10:00:00.000Z', busy);
    expect(
      readmeTable([{ ...withBusy, run: { ...withBusy.run, trials: 3, tasks: ['a', 'b'] } }]),
    ).toContain(
      '| 5 of 5 (100%), 1 left out (model never answered) | 1 · 0 · 0 · 0 (+1 with a session left out) |',
    );
  });
});
