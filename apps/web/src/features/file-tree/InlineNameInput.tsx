/**
 * The text box used to name a new file or folder, or rename one, in place.
 * Enter commits, Escape cancels. A refused name keeps the box open with the
 * reason underneath; leaving the box commits a changed name and otherwise
 * cancels, and a refusal on the way out is reported by the caller's toast.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { splitExtension } from '@collabcode/shared';

export type InlineNameInputProps = {
  initial: string;
  label: string;
  /** Returns an error message to show, or null when the name was accepted. */
  onCommit: (name: string) => string | null;
  onCancel: () => void;
  /** Called when the box is left with a name that was refused. */
  onAbandon: (message: string) => void;
};

export function InlineNameInput({
  initial,
  label,
  onCommit,
  onCancel,
  onAbandon,
}: InlineNameInputProps): React.ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef(false);

  // Select the part before the extension, as editors do, so typing replaces
  // "utils" and keeps ".js".
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(0, splitExtension(initial).stem.length);
  }, [initial]);

  const commit = (): string | null => {
    const name = value.trim();
    if (name === '' || name === initial) {
      settled.current = true;
      onCancel();
      return null;
    }
    const message = onCommit(name);
    if (message === null) settled.current = true;
    return message;
  };

  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <input
        ref={input}
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error ? 'inline-name-error' : undefined}
        value={value}
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            setError(commit());
          } else if (event.key === 'Escape') {
            event.preventDefault();
            settled.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          if (settled.current) return;
          const message = commit();
          if (message !== null) {
            settled.current = true;
            onAbandon(message);
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className="w-full min-w-0 rounded-sm border border-sky-600 bg-zinc-950 px-1 py-0 text-sm text-zinc-100 outline-none"
      />
      {error && (
        <span id="inline-name-error" role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </span>
      )}
    </span>
  );
}
