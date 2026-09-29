import { describe, expect, it } from 'vitest';
import { MINUTE_MS, createMinuteLimit } from './minute-limit.js';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000_000;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

function fill(limit: ReturnType<typeof createMinuteLimit>, count: number): void {
  for (let index = 0; index < count; index += 1) {
    expect(limit.waitMs()).toBe(0);
    limit.record();
  }
}

describe('createMinuteLimit', () => {
  it('lets the limit through, then says how long until the oldest expires', () => {
    const time = clock();
    const limit = createMinuteLimit(3, time.now);
    fill(limit, 3);
    expect(limit.waitMs()).toBe(MINUTE_MS);
    time.advance(20_000);
    expect(limit.waitMs()).toBe(40_000);
  });

  it('rolls: each request frees its slot a minute after it started', () => {
    const time = clock();
    const limit = createMinuteLimit(2, time.now);
    limit.record();
    time.advance(30_000);
    limit.record();
    expect(limit.waitMs()).toBe(30_000);

    time.advance(30_000);
    expect(limit.waitMs()).toBe(0);
    limit.record();
    // The request from 30 s ago still holds its slot for another 30 s.
    expect(limit.waitMs()).toBe(30_000);
  });

  it('does not let a full allowance through on each side of a minute boundary', () => {
    const time = clock();
    const limit = createMinuteLimit(12, time.now);
    time.advance(59_000);
    fill(limit, 12);
    time.advance(2_000);
    expect(limit.waitMs()).toBe(58_000);
  });

  it('counts only what was recorded, so a check alone uses nothing', () => {
    const limit = createMinuteLimit(1, clock().now);
    expect(limit.waitMs()).toBe(0);
    expect(limit.waitMs()).toBe(0);
    limit.record();
    expect(limit.waitMs()).toBeGreaterThan(0);
  });

  it('refuses everything when the limit is zero', () => {
    expect(createMinuteLimit(0, clock().now).waitMs()).toBe(MINUTE_MS);
  });
});
