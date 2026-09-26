import { useEffect, useState } from 'react';
import type { AwarenessUser } from '@collabcode/shared';
import { MAX_USER_NAME_LENGTH } from '@collabcode/shared';

export type IdentityFieldProps = {
  identity: AwarenessUser;
  onRename: (name: string) => void;
};

/**
 * Your display name. The committed value is sanitized by `withName`, so the
 * input is free to hold whatever is being typed.
 */
export function IdentityField({ identity, onRename }: IdentityFieldProps): React.ReactElement {
  const [draft, setDraft] = useState(identity.name);

  useEffect(() => {
    setDraft(identity.name);
  }, [identity.name]);

  return (
    <label className="flex items-center gap-2 text-xs text-zinc-400">
      <span className="sr-only">Your display name</span>
      <span
        aria-hidden
        style={{ backgroundColor: identity.color }}
        className="size-2.5 rounded-full"
      />
      <input
        value={draft}
        maxLength={MAX_USER_NAME_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="w-32 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200 focus:border-zinc-600 focus:outline-none"
      />
    </label>
  );
}
