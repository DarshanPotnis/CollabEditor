/**
 * The server the end-to-end tests run against: the real Express + Hocuspocus
 * composition, backed by the in-memory repo so the suite needs no database.
 *
 * This lives in test/ rather than behind a flag in index.ts on purpose — a
 * "store projects in memory" switch in production code is a footgun, and this
 * file is not part of the server bundle (see tsup.config.ts entries).
 */
import { pino } from 'pino';
import { createMemoryProjectsRepo } from '../db/memory-projects-repo.js';
import { createApp } from '../http/app.js';
import { createCollabServer } from '../collab/server.js';

const PORT = Number(process.env['E2E_PORT'] ?? 8081);
const HOST = '127.0.0.1';

const ALLOWED_ORIGINS = [
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
];

async function main(): Promise<void> {
  const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn' });
  const repo = createMemoryProjectsRepo();
  const app = createApp({
    allowedOrigins: ALLOWED_ORIGINS,
    repo,
    logger,
    // The browser talks to this server directly, with no proxy in front.
    clientIpSource: 'direct',
    // The suite creates many projects from one IP; the production limit would
    // start refusing them part way through a run.
    projectCreateLimitPerMinute: 10_000,
  });
  const server = createCollabServer({ app, repo, logger, port: PORT, host: HOST });

  await server.listen();
  logger.warn({ port: PORT }, 'e2e server listening (in-memory storage)');

  const shutdown = (): void => {
    void server.destroy().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
