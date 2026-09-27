/**
 * Refuses collaboration on documents that are not real projects.
 *
 * This runs as an onLoadDocument hook and is registered before the database
 * extension, so an unknown project never reaches storage. onLoadDocument is the
 * right place rather than onAuthenticate: the document name arrives in the
 * sync message, not in the WebSocket URL, so it is not known at upgrade time.
 */
import type { Extension } from '@hocuspocus/server';
import { projectIdSchema } from '@collabcode/shared';
import type { ProjectsRepo } from '../db/projects-repo.js';
import type { Logger } from '../lib/logger.js';
import { COLLAB_REJECTION_REASONS, CollabRejectionError } from './rejection.js';

export type ProjectGuardDeps = {
  repo: ProjectsRepo;
  logger: Logger;
};

export function createProjectGuard({ repo, logger }: ProjectGuardDeps): Extension {
  return {
    async onLoadDocument({ documentName, socketId }) {
      const parsed = projectIdSchema.safeParse(documentName);
      if (!parsed.success) {
        logger.warn({ documentName, socketId }, 'rejected collab connection: malformed project id');
        throw new CollabRejectionError(
          COLLAB_REJECTION_REASONS.invalidProjectId,
          `malformed project id: ${documentName}`,
        );
      }

      const project = await repo.findById(parsed.data);
      if (!project) {
        logger.warn({ projectId: parsed.data, socketId }, 'rejected collab connection: no project');
        throw new CollabRejectionError(
          COLLAB_REJECTION_REASONS.projectNotFound,
          `no project with id ${parsed.data}`,
        );
      }
    },
  };
}
