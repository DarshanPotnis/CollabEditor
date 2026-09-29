import { describe, expect, it } from 'vitest';
import type { TaskResult } from '../results/run-results.js';
import { pendingSessions, withResult } from './pending-sessions.js';

const metrics: TaskResult['metrics'] = {
  steps: 1,
  requests: 3,
  inputTokens: 0,
  outputTokens: 0,
  wallMs: 0,
  modelMs: 0,
  toolMs: 0,
  waitMs: 0,
  wastedSteps: 0,
  repeatedErrors: 0,
  refusedFinishes: 0,
  checksNotMade: 0,
};

const result = (task: string, trial: number, category: TaskResult['category']): TaskResult => ({
  task,
  title: task,
  trial,
  passed: category === null,
  category,
  grades: [],
  outcome: category === 'model-unavailable' ? 'failed' : 'finished',
  metrics,
  trace: `${task}-${String(trial)}.trace.json`,
});

const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('pendingSessions', () => {
  it('plays every session of a new run, trial by trial', () => {
    expect(
      pendingSessions(tasks, 2, []).map(({ task, trial }) => `${task.id}#${String(trial)}`),
    ).toEqual(['a#1', 'b#1', 'c#1', 'a#2', 'b#2', 'c#2']);
  });

  it('skips sessions with a verdict, and plays again one the model never answered', () => {
    const done = [
      result('a', 1, null),
      result('b', 1, 'model-unavailable'),
      result('c', 1, 'ran-out'),
    ];
    expect(pendingSessions(tasks, 1, done).map(({ task }) => task.id)).toEqual(['b']);
  });
});

describe('withResult', () => {
  it('replaces the earlier result of the same session where it was, or adds a new one', () => {
    const before = [
      result('a', 1, null),
      result('b', 1, 'model-unavailable'),
      result('c', 1, null),
    ];
    const again = result('b', 1, 'unverified');
    expect(withResult(before, again)).toEqual([before[0], again, before[2]]);
    const next = result('a', 2, null);
    expect(withResult(before, next)).toEqual([...before, next]);
  });
});
