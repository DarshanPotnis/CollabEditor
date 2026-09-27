/**
 * A modal confirmation built on the native <dialog> element, which gives a
 * focus trap, Escape to cancel and an inert background without a library.
 * The dialog opens when mounted; the parent unmounts it to close it.
 */
import { useEffect, useRef } from 'react';

export type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 text-zinc-100 shadow-xl backdrop:bg-black/60"
    >
      <h2 id="confirm-title" className="text-base font-semibold">
        {title}
      </h2>
      <p id="confirm-message" className="mt-2 text-sm text-zinc-300">
        {message}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            danger
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-zinc-100 text-zinc-950 hover:bg-white'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
