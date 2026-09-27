import { useEffect, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import type { Toast, ToastStore } from './toast-store.js';

function ToastItem({ toast, store }: { toast: Toast; store: ToastStore }): React.ReactElement {
  const [paused, setPaused] = useState(false);

  // Paused while hovered or focused, so there is time to read it or reach Undo.
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => store.dismiss(toast.id), toast.durationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [paused, store, toast.id, toast.durationMs]);

  return (
    <li
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-lg ${
        toast.tone === 'error'
          ? 'border-red-900 bg-red-950 text-red-100'
          : 'border-zinc-700 bg-zinc-900 text-zinc-100'
      }`}
    >
      <p className="flex-1">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            store.dismiss(toast.id);
          }}
          className="shrink-0 font-medium text-sky-300 hover:text-sky-200 focus-visible:underline focus-visible:outline-none"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => store.dismiss(toast.id)}
        className="shrink-0 text-zinc-400 hover:text-zinc-100"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

export function Toasts({ store }: { store: ToastStore }): React.ReactElement {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 [&>li]:pointer-events-auto"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} store={store} />
      ))}
    </ol>
  );
}
