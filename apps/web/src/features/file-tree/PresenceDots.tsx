import type { Collaborator } from '../../collab/collaborators.js';

const SHOWN = 3;

/** Who else has this file open. Colors come from the fixed palette. */
export function PresenceDots({
  people,
}: {
  people: readonly Collaborator[] | undefined;
}): React.ReactElement | null {
  if (!people || people.length === 0) return null;
  const names = people.map((person) => person.user.name).join(', ');
  const extra = people.length - SHOWN;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-2" title={`Open by ${names}`}>
      <span className="sr-only">Open by {names}</span>
      {people.slice(0, SHOWN).map((person) => (
        <span
          key={person.clientId}
          aria-hidden
          style={{ backgroundColor: person.user.color }}
          className="size-2 rounded-full ring-1 ring-zinc-950"
        />
      ))}
      {extra > 0 && (
        <span aria-hidden className="text-[10px] text-zinc-400">
          +{extra}
        </span>
      )}
    </span>
  );
}
