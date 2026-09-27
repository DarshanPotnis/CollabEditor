import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncScheduler } from './sync-scheduler.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const options = { quietMs: 250, maxWaitMs: 1_000, onError: vi.fn() };

describe('createSyncScheduler', () => {
  it('runs once after changes go quiet', async () => {
    const run = vi.fn(async () => {});
    const scheduler = createSyncScheduler(run, options);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(100);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(249);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still runs within maxWait while changes never stop', async () => {
    const run = vi.fn(async () => {});
    const scheduler = createSyncScheduler(run, options);
    for (let elapsed = 0; elapsed < 1_000; elapsed += 100) {
      scheduler.request();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never overlaps runs, and folds changes during a run into one follow-up', async () => {
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const run = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
    });
    const scheduler = createSyncScheduler(run, options);

    scheduler.request();
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1);

    // Three changes land while the first sync is still writing.
    for (let index = 0; index < 3; index += 1) {
      scheduler.request();
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(run).toHaveBeenCalledTimes(1);

    release.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    release.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('flush runs immediately and resolves once everything is applied', async () => {
    const applied: string[] = [];
    const scheduler = createSyncScheduler(() => {
      applied.push('sync');
      return Promise.resolve();
    }, options);
    scheduler.request();
    await scheduler.flush();
    expect(applied).toEqual(['sync']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(applied).toEqual(['sync']);
  });

  it('reports a failing run and keeps working', async () => {
    const onError = vi.fn();
    const run = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(run, { ...options, onError });
    await scheduler.flush();
    expect(onError).toHaveBeenCalledWith(new Error('disk full'));
    await scheduler.flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does nothing after dispose', async () => {
    const run = vi.fn(async () => {});
    const scheduler = createSyncScheduler(run, options);
    scheduler.request();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    await scheduler.flush();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).not.toHaveBeenCalled();
  });
});
