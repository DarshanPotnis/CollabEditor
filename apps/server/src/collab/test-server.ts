/**
 * Boots the real thing — Hocuspocus owning the HTTP server, Express mounted
 * inside it — against an in-memory repo on an ephemeral port. Used by the
 * integration tests so they exercise the production wiring, not a stub.
 */
import { pino } from 'pino';
import { createMemoryProjectsRepo, type MemoryProjectsRepo } from '../db/memory-projects-repo.js';
import { createApp, type CreateAppDeps } from '../http/app.js';
import type { ClientIpSource } from '../http/client-ip.js';
import type { Logger } from '../lib/logger.js';
import { createFakeModelGateway } from '../test/fake-model-gateway.js';
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
  logger?: Logger;
  projectCreateLimitPerMinute?: number;
  /** Defaults to `direct`: tests talk to the server with no proxy in front. */
  clientIpSource?: ClientIpSource;
  /** Defaults to a fake gateway, a shared tier with a fake key, and roomy limits. */
  ai?: Partial<CreateAppDeps['ai']>;
};

export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  const repo = options.repo ?? createMemoryProjectsRepo();
  const logger = options.logger ?? pino({ level: 'silent' });
  const app = createApp({
    allowedOrigins: options.allowedOrigins ?? ['http://localhost:5173'],
    repo,
    logger,
    clientIpSource: options.clientIpSource ?? 'direct',
    ai: {
      gateway: createFakeModelGateway(),
      sharedTier: { model: 'gemini-3.5-flash-lite', apiKey: 'shared-test-key' },
      limits: { global: 1_000, perIp: 1_000, perProject: 1_000 },
      sharedTierPerMinute: 1_000,
      agentPerMinute: 1_000,
      ...options.ai,
    },
    ...(options.projectCreateLimitPerMinute === undefined
      ? {}
      : { projectCreateLimitPerMinute: options.projectCreateLimitPerMinute }),
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
