import { describe, expect, it } from 'vitest';
import { HELPER_RESERVE, admitAgentStep } from './agent-admission.js';

const plenty = { global: 400, ip: 30, project: 60 };

function remainingOf(values: typeof plenty): () => typeof plenty {
  return () => values;
}

describe('admitAgentStep', () => {
  it('starts a shared-tier session when every step could be paid for', () => {
    expect(
      admitAgentStep({ tier: 'shared', stepsTaken: 0, remaining: remainingOf(plenty) }),
    ).toEqual({ ok: true });
  });

  it('refuses to start one the visitor could not finish, and says how many are left', () => {
    const verdict = admitAgentStep({
      tier: 'shared',
      stepsTaken: 0,
      remaining: remainingOf({ ...plenty, ip: 14 }),
    });
    expect(verdict).toEqual({
      ok: false,
      code: 'quota-exhausted',
      message: expect.stringContaining(
        'needs 15 of your shared free AI requests, and you have 14 left today',
      ) as string,
    });
  });

  it('refuses to start one the project could not finish', () => {
    const verdict = admitAgentStep({
      tier: 'shared',
      stepsTaken: 0,
      remaining: remainingOf({ ...plenty, project: 3 }),
    });
    expect(verdict.ok || verdict.message).toMatch(/this project has 3 left today/);
  });

  it('keeps a reserve of the global allowance for the one-shot helpers', () => {
    const justEnough = { ...plenty, global: 15 + HELPER_RESERVE };
    expect(
      admitAgentStep({ tier: 'shared', stepsTaken: 0, remaining: remainingOf(justEnough) }).ok,
    ).toBe(true);
    const verdict = admitAgentStep({
      tier: 'shared',
      stepsTaken: 0,
      remaining: remainingOf({ ...justEnough, global: justEnough.global - 1 }),
    });
    expect(verdict.ok || verdict.message).toMatch(/one-shot helpers still work/);
  });

  it('checks allowances only on the first step, so a running session can finish', () => {
    let reads = 0;
    const remaining = (): typeof plenty => {
      reads += 1;
      return { global: 0, ip: 0, project: 0 };
    };
    expect(admitAgentStep({ tier: 'shared', stepsTaken: 5, remaining }).ok).toBe(true);
    expect(reads).toBe(0);
  });

  it('never reads the shared allowances for a caller using their own key', () => {
    const remaining = (): typeof plenty => {
      throw new Error('should not be read');
    };
    expect(admitAgentStep({ tier: 'ownKey', stepsTaken: 0, remaining }).ok).toBe(true);
  });

  it('caps the steps of a session by tier', () => {
    expect(
      admitAgentStep({ tier: 'shared', stepsTaken: 14, remaining: remainingOf(plenty) }).ok,
    ).toBe(true);
    expect(
      admitAgentStep({ tier: 'shared', stepsTaken: 15, remaining: remainingOf(plenty) }),
    ).toEqual({
      ok: false,
      code: 'quota-exhausted',
      message:
        'An AI teammate session on the shared free tier can take at most 15 steps. Add your own key in AI settings for longer sessions.',
    });
    expect(
      admitAgentStep({ tier: 'ownKey', stepsTaken: 24, remaining: remainingOf(plenty) }).ok,
    ).toBe(true);
    expect(
      admitAgentStep({ tier: 'ownKey', stepsTaken: 25, remaining: remainingOf(plenty) }).ok,
    ).toBe(false);
  });
});
