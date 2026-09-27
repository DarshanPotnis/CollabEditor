/**
 * The Express app. It is mounted inside the Hocuspocus HTTP server (see
 * collab/server.ts and docs/decisions/003), so it is built here as a plain
 * request handler and never listens on a port itself.
 */
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../lib/logger.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import { sendApiError } from './errors.js';
import { createHealthRouter } from './routes/health.js';
import { createProjectsRouter } from './routes/projects.js';

/** Projects one IP may create per minute in production. */
export const DEFAULT_PROJECT_CREATE_LIMIT = 20;

export type CreateAppDeps = {
  allowedOrigins: string[];
  repo: ProjectsRepo;
  logger: Logger;
  startedAt?: number;
  /**
   * Raised by the end-to-end harness, which creates many projects from one IP
   * in quick succession. Production uses the default.
   */
  projectCreateLimitPerMinute?: number;
};

/**
 * Reject browser requests from origins that are not on the allowlist, before
 * the CORS middleware runs. A request with no Origin header is not a browser
 * request (curl, the health checker, a test) and is left alone.
 */
function createOriginGuard(allowedOrigins: string[], logger: Logger): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === undefined || allowed.has(origin)) {
      next();
      return;
    }
    logger.warn({ origin, path: req.path }, 'blocked request from disallowed origin');
    sendApiError(res, 'forbidden', 'This origin is not allowed to call the API.');
  };
}

export function createApp({
  allowedOrigins,
  repo,
  logger,
  startedAt = Date.now(),
  projectCreateLimitPerMinute = DEFAULT_PROJECT_CREATE_LIMIT,
}: CreateAppDeps): Express {
  const app = express();

  // Render terminates TLS and adds exactly one proxy hop, so req.ip is the
  // last entry of X-Forwarded-For. Needed for per-IP rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(createOriginGuard(allowedOrigins, logger));
  app.use(cors({ origin: allowedOrigins, credentials: false, maxAge: 600 }));
  app.use(express.json({ limit: '16kb' }));

  app.use(createHealthRouter(startedAt));
  app.use(
    '/api',
    createProjectsRouter({ repo, logger, createLimitPerMinute: projectCreateLimitPerMinute }),
  );

  app.use((_req, res) => {
    sendApiError(res, 'not-found', 'No such endpoint.');
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      sendApiError(res, 'bad-request', 'Request body is not valid JSON.');
      return;
    }
    req.log.error({ err: error }, 'unhandled request error');
    sendApiError(res, 'internal', 'Something went wrong on our side.');
  };
  app.use(errorHandler);

  return app;
}
