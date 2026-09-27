import type { Collaborator } from '../../collab/collaborators.js';

function initials(name: string): string {
  const letters = name
    .split(' ')
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '');
  return letters.join('').toUpperCase();
}

function Avatar({ collaborator }: { collaborator: Collaborator }): React.ReactElement {
  const label = collaborator.isYou ? `${collaborator.user.name} (you)` : collaborator.user.name;
  return (
    <span
      title={label}
      aria-label={label}
      // The colour is one of a fixed palette (enforced by the awareness
      // schema), so it is safe as an inline style.
      style={{ backgroundColor: collaborator.user.color }}
      className={`flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ${
        collaborator.isYou ? 'ring-zinc-100' : 'ring-zinc-900'
      }`}
    >
      {initials(collaborator.user.name)}
    </span>
  );
}

export function PresenceBar({
  collaborators,
}: {
  collaborators: readonly Collaborator[];
}): React.ReactElement {
  const count = collaborators.length;

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {collaborators.map((collaborator) => (
          <Avatar key={collaborator.clientId} collaborator={collaborator} />
        ))}
      </div>
      <span className="text-xs text-zinc-400">
        {count === 0 ? 'Connecting…' : count === 1 ? 'Just you' : `${String(count)} people here`}
      </span>
    </div>
  );
}
