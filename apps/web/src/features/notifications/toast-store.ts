/**
 * Short-lived messages: undo after a delete, a refused action, a cycle that
 * was resolved. The store only holds the list; each toast's timer lives in
 * the component, which pauses it while the toast is hovered or focused.
 */
export type ToastTone = 'info' | 'error';

export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  /** How long it stays up, unless paused. */
  durationMs: number;
};

export type ToastInput = Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number };

export type ToastStore = {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly Toast[];
};

export const MAX_TOASTS = 3;
const DEFAULT_DURATION_MS = 6_000;

export function createToastStore(): ToastStore {
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const publish = (next: readonly Toast[]): void => {
    toasts = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    show(input) {
      const toast: Toast = { durationMs: DEFAULT_DURATION_MS, ...input, id: nextId };
      nextId += 1;
      // Identical messages replace each other rather than stacking up.
      const others = toasts.filter((each) => each.message !== toast.message);
      publish([...others, toast].slice(-MAX_TOASTS));
      return toast.id;
    },
    dismiss(id) {
      if (toasts.some((toast) => toast.id === id)) {
        publish(toasts.filter((toast) => toast.id !== id));
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => toasts,
  };
}
