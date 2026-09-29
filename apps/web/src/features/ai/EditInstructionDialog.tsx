/**
 * Asks what "Edit with AI" should change about the selection. Built on the
 * native <dialog> element like ConfirmDialog: it opens when mounted and the
 * parent unmounts it to close. Enter sends; Shift+Enter starts a new line.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { AI_INPUT_LIMITS } from '@collabcode/shared';

export type EditInstructionDialogProps = {
  /** What is being edited, such as "routes/users.js, lines 12–15". */
  target: string;
  /** Sends the instruction, or returns why it cannot be sent. */
  onSubmit: (instruction: string) => string | null;
  onCancel: () => void;
};

export function EditInstructionDialog({
  target,
  onSubmit,
  onCancel,
}: EditInstructionDialogProps): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      element.close();
    };
  }, []);

  const submit = (): void => {
    setError(onSubmit(instruction));
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${ids}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 text-zinc-100 shadow-xl backdrop:bg-black/60"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id={`${ids}-title`} className="text-base font-semibold">
          Edit with AI
        </h2>
        <p className="mt-1 text-sm text-zinc-400">{target}</p>
        <label className="mt-4 block text-sm">
          What should change?
          <textarea
            autoFocus
            rows={3}
            value={instruction}
            maxLength={AI_INPUT_LIMITS.instructionChars}
            onChange={(event) => {
              setInstruction(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              submit();
            }}
            placeholder="For example: return 404 when the user is not found"
            className="mt-1 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          You will see the change before anything is applied.
        </p>
        {error !== null && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-white"
          >
            Edit with AI
          </button>
        </div>
      </form>
    </dialog>
  );
}
