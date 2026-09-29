import { describe, expect, it } from 'vitest';
import type { RunResults } from '../results/run-results.js';
import { resumeProblem, type ResumingWith } from './resume-check.js';

const started: RunResults['run'] = {
  id: '2026-09-29-gemini-3.8-flash-abc1234',
  startedAt: '2026-09-29T08:00:00.000Z',
  finishedAt: null,
  commit: 'abc1234',
  model: { provider: 'gemini', id: 'gemini-3.8-flash' },
  prompt: 'agent@3',
  graders: 'graders@2',
  regraded: null,
  tier: 'shared',
  trials: 1,
  tasks: ['delete-user', 'validate-post'],
  local: false,
  stoppedEarly: 'the day is used up',
};

const same: ResumingWith = {
  commit: 'abc1234',
  model: 'gemini-3.8-flash',
  graders: 'graders@2',
  tier: 'shared',
  tasks: ['delete-user', 'validate-post'],
  trials: 1,
};

describe('resumeProblem', () => {
  it('lets a run carry on with everything the same', () => {
    expect(resumeProblem(started, same)).toBeNull();
  });

  it('refuses another commit, and names every difference', () => {
    expect(
      resumeProblem(started, { ...same, commit: 'def5678', graders: 'graders@3', trials: 3 }),
    ).toBe(
      'Run 2026-09-29-gemini-3.8-flash-abc1234 started with commit abc1234 (this is def5678), graders@2 (this is graders@3), 1 trials (not 3). Resume it with the same options, from the commit it started at.',
    );
  });

  it('refuses another model or other tasks', () => {
    expect(resumeProblem(started, { ...same, model: 'gemini-3.5-flash-lite' })).toContain(
      'model gemini-3.8-flash (not gemini-3.5-flash-lite)',
    );
    expect(resumeProblem(started, { ...same, tasks: ['delete-user'] })).toContain(
      'tasks delete-user, validate-post (not delete-user)',
    );
  });
});
