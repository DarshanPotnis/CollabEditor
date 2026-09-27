import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import type { AwarenessUser } from '@collabcode/shared';
import type { Collaborator } from '../../collab/collaborators.js';
import { IdentityField } from '../presence/IdentityField.js';
import { PresenceBar } from '../presence/PresenceBar.js';

function ShareLink(): React.ReactElement {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(window.location.href).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {copied ? 'Link copied' : 'Copy invite link'}
    </button>
  );
}

export type WorkspaceHeaderProps = {
  projectName: string;
  collaborators: readonly Collaborator[];
  describeCollaborator: (collaborator: Collaborator) => string;
  onFollow: (collaborator: Collaborator) => void;
  identity: AwarenessUser;
  onRename: (name: string) => void;
};

export function WorkspaceHeader({
  projectName,
  collaborators,
  describeCollaborator,
  onFollow,
  identity,
  onRename,
}: WorkspaceHeaderProps): React.ReactElement {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm font-semibold tracking-tight hover:text-white">
          CollabCode
        </Link>
        <span className="text-zinc-700">/</span>
        <h1 className="text-sm text-zinc-300">{projectName}</h1>
      </div>
      <div className="flex items-center gap-4">
        <PresenceBar
          collaborators={collaborators}
          describe={describeCollaborator}
          onFollow={onFollow}
        />
        <IdentityField identity={identity} onRename={onRename} />
        <ShareLink />
      </div>
    </header>
  );
}
