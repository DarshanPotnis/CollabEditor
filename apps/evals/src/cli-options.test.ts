import { describe, expect, it } from 'vitest';
import { CliError, parseCliOptions, realRunGate, selectTasks } from './cli-options.js';

describe('the eval command', () => {
  it('defaults to the full suite once on Flash-Lite, on the shared tier', () => {
    expect(parseCliOptions([])).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      tasks: 'all',
      trials: 1,
      tier: 'shared',
      allowLocalRealRun: false,
    });
    expect(
      parseCliOptions(['--model', 'gemini-3.8-flash', '--tasks', 'comparison', '--rpd', '20']),
    ).toMatchObject({
      model: 'gemini-3.8-flash',
      tasks: 'comparison',
      rpd: 20,
    });
  });

  it('refuses options it does not know and values that are wrong', () => {
    expect(() => parseCliOptions(['--modle', 'x'])).toThrow(CliError);
    expect(() => parseCliOptions(['--trials', '0'])).toThrow(/--trials/);
    expect(() => parseCliOptions(['--tier', 'gold'])).toThrow(/--tier/);
    expect(() => parseCliOptions(['--model', '../../etc'])).toThrow(/--model/);
  });

  it('picks all tasks, the comparison subset, or named ones, and names unknown ones', () => {
    expect(selectTasks('all').length).toBeGreaterThanOrEqual(20);
    expect(selectTasks('comparison')).toHaveLength(6);
    expect(selectTasks('delete-user, get-user').map((task) => task.id)).toEqual([
      'delete-user',
      'get-user',
    ]);
    expect(() => selectTasks('delete-user,nope')).toThrow(/Unknown task: nope/);
  });

  it('runs real models in CI, and on this machine only when asked, with a warning', () => {
    const local = parseCliOptions([]);
    expect(() => realRunGate(local, {})).toThrow(/run in CI by default/);
    expect(realRunGate(parseCliOptions(['--allow-local-real-run']), {})).toMatchObject({
      local: true,
      warning: expect.stringContaining('on this machine') as unknown,
    });
    expect(
      realRunGate(parseCliOptions(['--key-file', '/tmp/key']), { GITHUB_ACTIONS: 'true' }),
    ).toEqual({
      local: false,
      warning: null,
    });
    // In CI the key comes from the one-time file, never from anywhere else.
    expect(() => realRunGate(local, { GITHUB_ACTIONS: 'true' })).toThrow(/--key-file/);
  });
});
