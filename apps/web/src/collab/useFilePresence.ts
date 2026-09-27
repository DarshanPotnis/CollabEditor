import { useRef } from 'react';
import type { Collaborator } from './collaborators.js';
import { filePresence, samePresence, type FilePresence } from './file-presence.js';

/** filePresence, keeping the same map object while nothing it shows changed. */
export function useFilePresence(collaborators: readonly Collaborator[]): FilePresence {
  const previous = useRef<FilePresence>(new Map());
  const next = filePresence(collaborators);
  if (!samePresence(previous.current, next)) previous.current = next;
  return previous.current;
}
