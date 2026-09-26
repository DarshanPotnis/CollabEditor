import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createProjectBodySchema,
  createProjectId,
  createProjectUpdate,
  projectIdSchema,
  TEMPLATES,
  type ProjectSummary,
} from '@collabcode/shared';
import type { Logger } from '../../lib/logger.js';
import type { ProjectRecord, ProjectsRepo } from '../../db/projects-repo.js';
import { sendApiError } from '../errors.js';

export type ProjectsRouterDeps = {
  repo: ProjectsRepo;
  logger: Logger;
  /** Projects one IP may create per minute. */
  createLimitPerMinute: number;
};

function toSummary(record: ProjectRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    template: record.template,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createProjectsRouter({
  repo,
  logger,
  createLimitPerMinute,
}: ProjectsRouterDeps): Router {
  const router = Router();

  const createLimiter = rateLimit({
    windowMs: 60_000,
    limit: createLimitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      sendApiError(res, 'rate-limited', 'Too many projects created. Try again in a minute.');
    },
  });

  router.post('/projects', createLimiter, async (req, res) => {
    const body = createProjectBodySchema.safeParse(req.body);
    if (!body.success) {
      sendApiError(res, 'bad-request', body.error.issues[0]?.message ?? 'invalid request body');
      return;
    }

    const id = createProjectId();
    const name = body.data.name ?? TEMPLATES[body.data.template].label;
    const { update } = createProjectUpdate({ name, template: body.data.template });
    const record = await repo.create({ id, name, template: body.data.template, ydoc: update });

    logger.info({ projectId: id, template: body.data.template }, 'project created');
    res.status(201).json(toSummary(record));
  });

  router.get('/projects/:id', async (req, res) => {
    const id = projectIdSchema.safeParse(req.params.id);
    if (!id.success) {
      sendApiError(res, 'not-found', 'No project with that ID.');
      return;
    }

    const record = await repo.findById(id.data);
    if (!record) {
      sendApiError(res, 'not-found', 'No project with that ID.');
      return;
    }

    res.json(toSummary(record));
  });

  return router;
}
