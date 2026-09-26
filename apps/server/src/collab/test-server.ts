/**
 * Boots the real thing — Hocuspocus owning the HTTP server, Express mounted
 * inside it — against an in-memory repo on an ephemeral port. Used by the
 * integration tests so they exercise the production wiring, not a stub.
 */
import { pino } from 'pino';
import { createMemoryProjectsRepo, type MemoryProjectsRepo } from '../db/memory-projects-repo.js';
import { createApp } from '../http/app.js';
import { createCollabServer } from './server.js';

export type TestServer = {
  repo: MemoryProjectsRepo;
  httpUrl: string;
  collabUrl: string;
  stop: () => Promise<void>;
};

export type StartTestServerOptions = {
  allowedOrigins?: string[];
  repo?: MemoryProjectsRepo;
};

export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  const repo = options.repo ?? createMemoryProjectsRepo();
  const logger = pino({ level: 'silent' });
  const app = createApp({
    allowedOrigins: options.allowedOrigins ?? ['http://localhost:5173'],
    repo,
    logger,
  });
  const server = createCollabServer({ app, repo, logger, port: 0, host: '127.0.0.1' });

  await server.listen();
  const { port } = server.address;

  return {
    repo,
    httpUrl: `http://127.0.0.1:${port}`,
    collabUrl: `ws://127.0.0.1:${port}/collab`,
    stop: () => server.destroy(),
  };
}
