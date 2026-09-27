import { useEffect, useState } from 'react';
import type { ProjectSummary } from '@collabcode/shared';
import { ApiError, fetchProject } from '../../lib/api.js';

export type ProjectSummaryState =
  | { status: 'loading' }
  | { status: 'found'; project: ProjectSummary }
  | { status: 'missing' }
  | { status: 'error'; message: string };

/**
 * Looks the project up before opening a socket to it, so an unknown ID shows a
 * 404 page instead of a connection that is refused a moment later.
 */
export function useProjectSummary(projectId: string): ProjectSummaryState {
  const [state, setState] = useState<ProjectSummaryState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });

    fetchProject(projectId)
      .then((project) => {
        if (!live) return;
        setState(project ? { status: 'found', project } : { status: 'missing' });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const message = error instanceof ApiError ? error.message : 'Could not load this project.';
        setState({ status: 'error', message });
      });

    return () => {
      live = false;
    };
  }, [projectId]);

  return state;
}
