/**
 * Following a collaborator: which file clicking their avatar opens, and what
 * the avatar says it will do. Files that were deleted still open (read-only),
 * since the collaborator may be looking at one to decide whether to restore it.
 */
import type { ResolvedTree } from '@collabcode/shared';
import { agentHostName, type Collaborator } from './collaborators.js';

export type FollowTarget =
  { kind: 'file'; fileId: string; name: string } | { kind: 'nowhere'; message: string };

export function followTarget(collaborator: Collaborator, tree: ResolvedTree): FollowTarget {
  const { name } = collaborator.user;
  const fileId = collaborator.activeFileId;
  if (fileId === null) return { kind: 'nowhere', message: `${name} doesn't have a file open.` };

  const live = tree.byId.get(fileId);
  if (live?.kind === 'file') return { kind: 'file', fileId, name: live.path };
  const hidden = tree.hidden.get(fileId);
  if (hidden?.kind === 'file') return { kind: 'file', fileId, name: `${hidden.name} (deleted)` };

  return { kind: 'nowhere', message: `${name} is looking at a file that no longer exists.` };
}

/**
 * Who an avatar is. An AI agent says whom it works for, named by what that
 * person shows (not by the agent's own claim), and what it is doing.
 */
function whoIs(collaborator: Collaborator, everyone: readonly Collaborator[]): string {
  const { name, kind } = collaborator.user;
  if (kind !== 'agent') return name;
  const { agent } = collaborator;
  const host = agent === null ? null : agentHostName(agent, everyone);
  const status = agent === null ? '' : `: ${agent.status}`;
  return `${name} (AI, working for ${host ?? 'someone who has left'})${status}`;
}

/** The avatar's accessible label: who it is, and where clicking it takes you. */
export function followLabel(
  collaborator: Collaborator,
  tree: ResolvedTree,
  everyone: readonly Collaborator[],
): string {
  const who = whoIs(collaborator, everyone);
  const target = followTarget(collaborator, tree);
  const their = collaborator.user.kind === 'agent' ? 'its' : 'their';
  return target.kind === 'file'
    ? `${who}, in ${target.name}. Go to ${their} cursor`
    : `${who}, no file open`;
}
