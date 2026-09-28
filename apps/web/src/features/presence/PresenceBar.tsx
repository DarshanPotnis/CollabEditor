import { Bot } from 'lucide-react';
import type { Collaborator } from '../../collab/collaborators.js';

function initials(name: string): string {
  const letters = name
    .split(' ')
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '');
  return letters.join('').toUpperCase();
}

function Avatar({
  collaborator,
  label,
  onFollow,
}: {
  collaborator: Collaborator;
  label: string;
  onFollow: (() => void) | null;
}): React.ReactElement {
  const className = `flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ${
    collaborator.isYou ? 'ring-zinc-100' : 'ring-zinc-900'
  }`;
  // The colour is one of a fixed palette (enforced by the awareness schema),
  // so it is safe as an inline style.
  const style = { backgroundColor: collaborator.user.color };
  // An AI agent shows a robot rather than initials, whatever name it gives.
  const letters =
    collaborator.user.kind === 'agent' ? (
      <Bot aria-hidden="true" className="size-4" />
    ) : (
      initials(collaborator.user.name)
    );

  if (!onFollow) {
    return (
      <span title={label} aria-label={label} style={style} className={className}>
        {letters}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onFollow}
      style={style}
      className={`${className} cursor-pointer hover:z-10 hover:ring-zinc-400 focus-visible:z-10 focus-visible:ring-sky-400 focus-visible:outline-none`}
    >
      {letters}
    </button>
  );
}

export type PresenceBarProps = {
  collaborators: readonly Collaborator[];
  /** Where clicking a collaborator goes, for their label. */
  describe: (collaborator: Collaborator) => string;
  onFollow: (collaborator: Collaborator) => void;
};

/** "Just you", "3 people here", "You and an AI teammate here". */
function whoIsHere(collaborators: readonly Collaborator[]): string {
  const agents = collaborators.filter((collaborator) => collaborator.user.kind === 'agent').length;
  const people = collaborators.length - agents;
  if (collaborators.length === 0) return 'Connecting…';
  if (agents === 0) return people === 1 ? 'Just you' : `${String(people)} people here`;
  const humans = people === 1 ? 'You' : `${String(people)} people`;
  const ais = agents === 1 ? 'an AI teammate' : `${String(agents)} AI teammates`;
  return `${humans} and ${ais} here`;
}

export function PresenceBar({
  collaborators,
  describe,
  onFollow,
}: PresenceBarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {collaborators.map((collaborator) => (
          <Avatar
            key={collaborator.clientId}
            collaborator={collaborator}
            label={collaborator.isYou ? `${collaborator.user.name} (you)` : describe(collaborator)}
            onFollow={collaborator.isYou ? null : () => onFollow(collaborator)}
          />
        ))}
      </div>
      <span className="text-xs text-zinc-400">{whoIsHere(collaborators)}</span>
    </div>
  );
}
