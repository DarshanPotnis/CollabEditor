import { describe, expect, it, vi } from 'vitest';
import { MAX_TOASTS, createToastStore } from './toast-store.js';

describe('createToastStore', () => {
  it('shows toasts in order with a default duration, and dismisses by id', () => {
    const store = createToastStore();
    const first = store.show({ message: 'one', tone: 'info' });
    store.show({ message: 'two', tone: 'error', durationMs: 1_000 });

    expect(store.getSnapshot().map((toast) => [toast.message, toast.durationMs])).toEqual([
      ['one', 6_000],
      ['two', 1_000],
    ]);
    store.dismiss(first);
    expect(store.getSnapshot().map((toast) => toast.message)).toEqual(['two']);
  });

  it(`keeps at most ${String(MAX_TOASTS)}, dropping the oldest`, () => {
    const store = createToastStore();
    for (const message of ['a', 'b', 'c', 'd']) store.show({ message, tone: 'info' });
    expect(store.getSnapshot().map((toast) => toast.message)).toEqual(['b', 'c', 'd']);
  });

  it('replaces a toast with the same message instead of stacking it', () => {
    const store = createToastStore();
    store.show({ message: 'same', tone: 'info' });
    const second = store.show({ message: 'same', tone: 'info' });
    expect(store.getSnapshot().map((toast) => toast.id)).toEqual([second]);
  });

  it('notifies subscribers, and not for dismissing an unknown id', () => {
    const store = createToastStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.show({ message: 'x', tone: 'info' });
    store.dismiss(999);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
