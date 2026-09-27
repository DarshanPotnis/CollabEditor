/**
 * Following a collaborator: which file clicking their avatar opens, and what
 * the avatar says it will do. Files that were deleted still open (read-only),
 * since the collaborator may be looking at one to decide whether to restore it.
 */
import type { ResolvedTree } from '@collabcode/shared';
import type { Collaborator } from './collaborators.js';

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

/** The avatar's accessible label: where clicking it takes you. */
export function followLabel(collaborator: Collaborator, tree: ResolvedTree): string {
  const target = followTarget(collaborator, tree);
  return target.kind === 'file'
    ? `${collaborator.user.name}, in ${target.name}. Go to their cursor`
    : `${collaborator.user.name}, no file open`;
}
