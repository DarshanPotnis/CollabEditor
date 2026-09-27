/**
 * Entry point: parse configuration, wire storage, HTTP and collab together,
 * start listening, and shut down cleanly when Render sends SIGTERM.
 */
import { ConfigError, loadConfig } from './config.js';
import { createBootstrapLogger, createLogger, type Logger } from './lib/logger.js';
import { createSqlClient } from './db/client.js';
import { createPostgresProjectsRepo } from './db/projects-repo.js';
import { createApp } from './http/app.js';
import { createCollabServer } from './collab/server.js';

/** How long shutdown may take before we stop waiting. Render allows ~30s. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function withTimeout(work: Promise<unknown>, ms: number, label: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function installShutdownHandlers(
  shutdown: (signal: string) => Promise<void>,
  logger: Logger,
): void {
  let running = false;
  const handle = (signal: string): void => {
    if (running) {
      logger.warn({ signal }, 'shutdown already in progress');
      return;
    }
    running = true;
    void shutdown(signal);
  };
  process.on('SIGTERM', () => handle('SIGTERM'));
  process.on('SIGINT', () => handle('SIGINT'));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');

  const sql = createSqlClient(config.DATABASE_URL);
  const repo = createPostgresProjectsRepo(sql);

  const app = createApp({
    allowedOrigins: config.ALLOWED_ORIGINS,
    repo,
    logger,
    clientIpSource: config.CLIENT_IP_SOURCE,
  });
  const server = createCollabServer({
    app,
    repo,
    logger,
    port: config.PORT,
    host: config.HOST,
  });

  await server.listen();
  logger.info(
    {
      port: config.PORT,
      host: config.HOST,
      allowedOrigins: config.ALLOWED_ORIGINS,
      clientIpSource: config.CLIENT_IP_SOURCE,
    },
    'collabcode server listening',
  );

  installShutdownHandlers(async (signal) => {
    logger.info({ signal }, 'shutting down');
    try {
      // Stops accepting connections, closes the open ones and flushes every
      // pending document store before resolving.
      await withTimeout(server.destroy(), SHUTDOWN_TIMEOUT_MS, 'collab server shutdown');
      await withTimeout(sql.end({ timeout: 5 }), SHUTDOWN_TIMEOUT_MS, 'database shutdown');
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown did not finish cleanly');
      process.exit(1);
    }
  }, logger);
}

main().catch((error: unknown) => {
  const logger = createBootstrapLogger();
  if (error instanceof ConfigError) {
    logger.fatal(error.message);
  } else {
    logger.fatal({ err: error }, 'server failed to start');
  }
  process.exit(1);
});
