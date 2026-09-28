import { describe, expect, it, vi } from 'vitest';
import { createFakeClock } from './fake-clock.js';
import { createStopSource, stopOnAny } from './stop-source.js';

describe('createStopSource', () => {
  it('tells each listener once, and one added later at once', () => {
    const source = createStopSource();
    const early = vi.fn();
    source.signal.addEventListener('abort', early);
    source.stop();
    source.stop();
    const late = vi.fn();
    source.signal.addEventListener('abort', late);
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
    expect(source.signal.aborted).toBe(true);
  });
});

describe('stopOnAny', () => {
  it('stops when any signal does, standard AbortSignals included', () => {
    const controller = new AbortController();
    const combined = stopOnAny([createStopSource().signal, controller.signal]);
    expect(combined.signal.aborted).toBe(false);
    controller.abort();
    expect(combined.signal.aborted).toBe(true);
  });

  it('starts stopped when a signal already has', () => {
    expect(stopOnAny([AbortSignal.abort()]).signal.aborted).toBe(true);
  });

  it('stops listening once disposed', () => {
    const controller = new AbortController();
    const combined = stopOnAny([controller.signal]);
    combined.dispose();
    controller.abort();
    expect(combined.signal.aborted).toBe(false);
  });
});

describe('createFakeClock', () => {
  it('wakes a sleep when its time comes, or when it is stopped', async () => {
    const clock = createFakeClock(100);
    const woke: string[] = [];
    const stop = createStopSource();
    const long = clock.sleep(1_000, stop.signal).then(() => woke.push('long'));
    const short = clock.sleep(50, createStopSource().signal).then(() => woke.push('short'));
    expect(clock.nextWakeAt()).toBe(150);
    clock.advance(60);
    await short;
    expect(woke).toEqual(['short']);
    stop.stop();
    await long;
    expect(woke).toEqual(['short', 'long']);
    expect(clock.now()).toBe(160);
    expect(clock.nextWakeAt()).toBeNull();
  });
});
