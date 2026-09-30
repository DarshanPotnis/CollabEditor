/**
 * The Express app. It is mounted inside the Hocuspocus HTTP server (see
 * collab/server.ts and docs/decisions/003), so it is built here as a plain
 * request handler and never listens on a port itself.
 */
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import cors from 'cors';
import type { Logger } from '../lib/logger.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import { clientKey, warnOnceUntrusted, type ClientIpSource, type IpRequest } from './client-ip.js';
import { sendApiError } from './errors.js';
import { requestLogging } from './request-logging.js';
import { createAiRouter, type AiRouterDeps } from './routes/ai.js';
import { createHealthRouter } from './routes/health.js';
import { createProjectsRouter } from './routes/projects.js';

/** Projects one IP may create per minute in production. */
export const DEFAULT_PROJECT_CREATE_LIMIT = 20;

export type CreateAppDeps = {
  allowedOrigins: string[];
  repo: ProjectsRepo;
  logger: Logger;
  /** Where per-IP limits read the client's address from (http/client-ip.ts). */
  clientIpSource: ClientIpSource;
  /** The model proxy: which gateway to call, the shared tier and its limits. */
  ai: Omit<AiRouterDeps, 'repo' | 'clientKey'>;
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

/** The error express.json raises for a body over its limit. */
function isBodyTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large'
  );
}

export function createApp({
  allowedOrigins,
  repo,
  logger,
  clientIpSource,
  ai,
  startedAt = Date.now(),
  projectCreateLimitPerMinute = DEFAULT_PROJECT_CREATE_LIMIT,
}: CreateAppDeps): Express {
  const app = express();

  // 'trust proxy' stays unset: per-IP limits read the client address through
  // clientKey() instead, which checks two proxy-written sources against each other.
  app.disable('x-powered-by');
  const onUntrusted = warnOnceUntrusted(logger);
  const keyOf = (req: IpRequest): string => clientKey(req, clientIpSource, onUntrusted);

  app.use(requestLogging(logger));
  app.use(createOriginGuard(allowedOrigins, logger));
  app.use(cors({ origin: allowedOrigins, credentials: false, maxAge: 600 }));
  // The AI route parses its own, larger bodies, so it comes before the 16 kB
  // parser the rest of the API uses.
  app.use(createAiRouter({ ...ai, repo, clientKey: keyOf }));
  app.use(express.json({ limit: '16kb' }));

  app.use(createHealthRouter(startedAt));
  app.use(
    '/api',
    createProjectsRouter({
      repo,
      logger,
      clientKey: keyOf,
      createLimitPerMinute: projectCreateLimitPerMinute,
    }),
  );

  app.use((_req, res) => {
    sendApiError(res, 'not-found', 'No such endpoint.');
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      sendApiError(res, 'bad-request', 'Request body is not valid JSON.');
      return;
    }
    if (isBodyTooLarge(error)) {
      sendApiError(res, 'payload-too-large', 'The request is too large.');
      return;
    }
    req.log.error({ err: error }, 'unhandled request error');
    sendApiError(res, 'internal', 'Something went wrong on our side.');
  };
  app.use(errorHandler);

  return app;
}
