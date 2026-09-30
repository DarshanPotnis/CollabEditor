import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeClock, createStopSource } from '@collabcode/agent';
import { afterEach, describe, expect, it } from 'vitest';
import { limitsFor } from './model-limits.js';
import { createPacer, pacedRpm } from './pacer.js';
import { DailyLimitReached, RequestLedger, pacificDay } from './request-ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function ledgerFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eval-ledger-'));
  dirs.push(dir);
  return join(dir, 'usage.json');
}

describe('the pacer', () => {
  it('lets rpm requests start in a minute, then waits for the oldest to age out', async () => {
    const clock = createFakeClock(0);
    const pacer = createPacer(2, clock);
    const signal = createStopSource().signal;
    await pacer.wait(signal);
    clock.advance(10_000);
    await pacer.wait(signal);
    let third = false;
    const waiting = pacer.wait(signal).then(() => (third = true));
    await Promise.resolve();
    expect(third).toBe(false);
    clock.advance(49_999);
    await Promise.resolve();
    expect(third).toBe(false);
    clock.advance(1);
    await waiting;
    expect(clock.now()).toBe(60_000);
  });

  it('keeps 20% under the per-minute limit, and always allows one', () => {
    expect(pacedRpm(15)).toBe(12);
    expect(pacedRpm(5)).toBe(4);
    expect(pacedRpm(2)).toBe(1);
    expect(pacedRpm(1)).toBe(1);
  });

  it("paced for Flash-Lite's 15, starts at most 12 in any minute", async () => {
    const clock = createFakeClock(0);
    const pacer = createPacer(pacedRpm(limitsFor('gemini-3.5-flash-lite').rpm), clock);
    const signal = createStopSource().signal;
    for (let i = 0; i < 12; i += 1) {
      await pacer.wait(signal);
      clock.advance(1_000);
    }
    let thirteenth = false;
    const waiting = pacer.wait(signal).then(() => (thirteenth = true));
    clock.advance(47_999);
    await Promise.resolve();
    expect(thirteenth).toBe(false);
    clock.advance(1);
    await waiting;
    expect(clock.now()).toBe(60_000);
  });

  it('stops waiting when the session stops', async () => {
    const clock = createFakeClock(0);
    const pacer = createPacer(1, clock);
    const stop = createStopSource();
    await pacer.wait(stop.signal);
    const waiting = pacer.wait(stop.signal);
    stop.stop();
    await waiting;
    expect(clock.now()).toBe(0);
  });
});

describe('the request ledger', () => {
  it('counts per model per Pacific day, and keeps the count across runs', async () => {
    const path = await ledgerFile();
    // 23:30 UTC on 29 September is 16:30 in California: still the 29th there.
    let now = Date.UTC(2026, 8, 29, 23, 30);
    const ledger = await RequestLedger.open(path, () => now);
    expect(pacificDay(now)).toBe('2026-09-29');
    await ledger.record('gemini-3.8-flash');
    await ledger.record('gemini-3.8-flash');
    await ledger.record('gemini-3.5-flash-lite');

    const reopened = await RequestLedger.open(path, () => now);
    expect(reopened.used('gemini-3.8-flash')).toBe(2);
    expect(() => reopened.ensureRoom('gemini-3.8-flash', 2)).toThrow(DailyLimitReached);
    expect(() => reopened.ensureRoom('gemini-3.8-flash', 3)).not.toThrow();

    // 08:00 UTC on the 30th is 01:00 Pacific: a new day, a new allowance.
    now = Date.UTC(2026, 8, 30, 8);
    expect(reopened.used('gemini-3.8-flash')).toBe(0);
    await reopened.record('gemini-3.8-flash');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      '2026-09-29': { 'gemini-3.8-flash': 2, 'gemini-3.5-flash-lite': 1 },
      '2026-09-30': { 'gemini-3.8-flash': 1 },
    });
  });

  it('knows the two models, and gives an unknown one very little', () => {
    expect(limitsFor('gemini-3.8-flash').rpd).toBeLessThanOrEqual(20);
    expect(limitsFor('gemini-9-typo')).toEqual({ rpm: 2, rpd: 10 });
    expect(limitsFor('gemini-3.8-flash', { rpd: 12 }).rpd).toBe(12);
  });
});
