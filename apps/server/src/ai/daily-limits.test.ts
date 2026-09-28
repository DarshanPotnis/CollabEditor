import { describe, expect, it } from 'vitest';
import { createDailyLimiter, quotaDay } from './daily-limits.js';

function clock(start: string): { now: () => number; set: (iso: string) => void } {
  let current = Date.parse(start);
  return {
    now: () => current,
    set: (iso) => {
      current = Date.parse(iso);
    },
  };
}

const NOON = '2026-09-27T19:00:00Z';

describe('quotaDay', () => {
  it('follows Pacific time, where Google resets the free quota', () => {
    // 06:59 UTC is still 23:59 the day before in California (PDT, UTC-7).
    expect(quotaDay(Date.parse('2026-09-27T06:59:59Z'))).toBe('2026-09-26');
    expect(quotaDay(Date.parse('2026-09-27T07:00:00Z'))).toBe('2026-09-27');
  });

  it('moves with daylight saving time', () => {
    // In December California is on PST, UTC-8.
    expect(quotaDay(Date.parse('2026-12-01T07:59:59Z'))).toBe('2026-11-30');
    expect(quotaDay(Date.parse('2026-12-01T08:00:00Z'))).toBe('2026-12-01');
  });
});

describe('createDailyLimiter', () => {
  it('lets a visitor use their allowance, counting down what is left', () => {
    const limiter = createDailyLimiter({ global: 100, perIp: 3, perProject: 100 }, clock(NOON).now);
    const caller = { ipKey: '203.0.113.1', projectId: 'p1' };
    expect(limiter.tryConsume(caller)).toMatchObject({ ok: true, remaining: 2 });
    expect(limiter.tryConsume(caller)).toMatchObject({ ok: true, remaining: 1 });
    expect(limiter.tryConsume(caller)).toMatchObject({ ok: true, remaining: 0 });
    expect(limiter.tryConsume(caller)).toEqual({ ok: false, exceeded: 'ip' });
  });

  it('keeps visitors apart', () => {
    const limiter = createDailyLimiter({ global: 100, perIp: 1, perProject: 100 }, clock(NOON).now);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p1' }).ok).toBe(true);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p2' }).ok).toBe(false);
    expect(limiter.tryConsume({ ipKey: 'b', projectId: 'p1' }).ok).toBe(true);
  });

  it('caps a project whoever is asking', () => {
    const limiter = createDailyLimiter({ global: 100, perIp: 100, perProject: 2 }, clock(NOON).now);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p1' }).ok).toBe(true);
    expect(limiter.tryConsume({ ipKey: 'b', projectId: 'p1' }).ok).toBe(true);
    expect(limiter.tryConsume({ ipKey: 'c', projectId: 'p1' })).toEqual({
      ok: false,
      exceeded: 'project',
    });
    expect(limiter.tryConsume({ ipKey: 'c', projectId: 'p2' }).ok).toBe(true);
  });

  it('stops everyone once the global budget is spent, and says so first', () => {
    const limiter = createDailyLimiter({ global: 2, perIp: 1, perProject: 100 }, clock(NOON).now);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(true);
    expect(limiter.tryConsume({ ipKey: 'b', projectId: 'p' }).ok).toBe(true);
    // 'a' has also used their own allowance, but the budget is the real reason.
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' })).toEqual({
      ok: false,
      exceeded: 'global',
    });
    expect(limiter.tryConsume({ ipKey: 'c', projectId: 'p' })).toEqual({
      ok: false,
      exceeded: 'global',
    });
  });

  it('reports the tightest allowance as what is left', () => {
    const limiter = createDailyLimiter({ global: 10, perIp: 5, perProject: 2 }, clock(NOON).now);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' })).toMatchObject({
      ok: true,
      remaining: 1,
    });
  });

  it('does not count a refused request against the other allowances', () => {
    const limiter = createDailyLimiter({ global: 100, perIp: 1, perProject: 2 }, clock(NOON).now);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(true);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(false);
    // Had the refusal counted, the project would now be full.
    expect(limiter.tryConsume({ ipKey: 'b', projectId: 'p' }).ok).toBe(true);
  });

  it('starts every allowance again at midnight Pacific time', () => {
    const time = clock('2026-09-27T06:30:00Z');
    const limiter = createDailyLimiter({ global: 1, perIp: 1, perProject: 1 }, time.now);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(true);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(false);

    time.set('2026-09-27T06:59:59Z');
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(false);

    time.set('2026-09-27T07:00:00Z');
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' })).toMatchObject({
      ok: true,
      remaining: 0,
    });
  });

  it('gives a refunded request back to every allowance', () => {
    const limiter = createDailyLimiter({ global: 1, perIp: 1, perProject: 1 }, clock(NOON).now);
    const first = limiter.tryConsume({ ipKey: 'a', projectId: 'p' });
    if (!first.ok) throw new Error('expected the first request to be accepted');
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(false);

    first.refund();
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' })).toMatchObject({
      ok: true,
      remaining: 0,
    });
  });

  it('refunds a request only once', () => {
    const limiter = createDailyLimiter({ global: 100, perIp: 2, perProject: 100 }, clock(NOON).now);
    const first = limiter.tryConsume({ ipKey: 'a', projectId: 'p' });
    if (!first.ok) throw new Error('expected the first request to be accepted');
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(true);

    first.refund();
    first.refund();
    // One slot came back, not two.
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(true);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(false);
  });

  it("does not refund into a new day's allowance", () => {
    const time = clock('2026-09-27T06:59:00Z');
    const limiter = createDailyLimiter({ global: 100, perIp: 1, perProject: 100 }, time.now);
    const lateNight = limiter.tryConsume({ ipKey: 'a', projectId: 'p' });
    if (!lateNight.ok) throw new Error('expected the request to be accepted');

    time.set('2026-09-27T07:00:00Z');
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(true);
    lateNight.refund();
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' }).ok).toBe(false);
  });

  it('refuses everything when a limit is zero, which turns the shared tier off', () => {
    const limiter = createDailyLimiter({ global: 0, perIp: 30, perProject: 60 }, clock(NOON).now);
    expect(limiter.tryConsume({ ipKey: 'a', projectId: 'p' })).toEqual({
      ok: false,
      exceeded: 'global',
    });
  });
});

describe('remaining', () => {
  const limits = { global: 10, perIp: 4, perProject: 6 };
  const alice = { ipKey: 'alice', projectId: 'p1' };

  it('reports what is left of each allowance without counting anything', () => {
    const limiter = createDailyLimiter(limits, clock(NOON).now);
    limiter.tryConsume(alice);
    limiter.tryConsume({ ipKey: 'bob', projectId: 'p1' });
    expect(limiter.remaining(alice)).toEqual({ global: 8, ip: 3, project: 4 });
    expect(limiter.remaining(alice)).toEqual({ global: 8, ip: 3, project: 4 });
  });

  it('starts from the full allowances on a new day', () => {
    const time = clock(NOON);
    const limiter = createDailyLimiter(limits, time.now);
    limiter.tryConsume(alice);
    time.set('2026-09-28T19:00:00Z');
    expect(limiter.remaining(alice)).toEqual({ global: 10, ip: 4, project: 6 });
  });
});
