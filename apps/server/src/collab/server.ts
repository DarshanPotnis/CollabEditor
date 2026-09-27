/**
 * The collab server, which is also *the* HTTP server.
 *
 * Hocuspocus 4 creates and owns the Node HTTP server; there is no supported way
 * to hand it one. So Express is mounted inside it through the onRequest hook,
 * and WebSocket upgrades are restricted to /collab in onUpgrade. See
 * docs/decisions/003.
 *
 * Both hooks follow the Hocuspocus convention for "I handled this, stop":
 * reject the hook chain with a falsy value. Hocuspocus rethrows only truthy
 * rejections, so this stops the chain without raising an error.
 */
import { Socket } from 'node:net';
import { Server, type Extension } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import type { Express } from 'express';
import { COLLAB_PATH, MAX_TRANSPORT_PAYLOAD } from '@collabcode/shared';
import type { ProjectsRepo } from '../db/projects-repo.js';
import type { Logger } from '../lib/logger.js';
import { createCollabLogging } from './logging.js';
import { createProjectGuard } from './project-guard.js';

/** Wait this long after the last change before writing a snapshot. */
const STORE_DEBOUNCE_MS = 2_000;
/** ...but never wait longer than this while someone keeps typing. */
const STORE_MAX_DEBOUNCE_MS = 10_000;

export type CollabServerDeps = {
  app: Express;
  repo: ProjectsRepo;
  logger: Logger;
  port: number;
  host: string;
};

/** Signals "handled, stop the hook chain" to Hocuspocus. */
function stopHookChain(): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Hocuspocus rethrows truthy rejections; a falsy one is how a hook says "handled"
  return Promise.reject();
}

export function createCollabServer({ app, repo, logger, port, host }: CollabServerDeps): Server {
  const httpMount: Extension = {
    onRequest({ request, response }) {
      // Express owns the response from here on.
      app(request, response);
      return stopHookChain();
    },

    onUpgrade({ request, socket }) {
      const path = (request.url ?? '').split('?')[0];
      if (path === COLLAB_PATH) return Promise.resolve();

      logger.warn({ path }, 'rejected websocket upgrade on unexpected path');
      // The hook payload types socket as `any`; narrow it before touching it.
      if (socket instanceof Socket) socket.destroy();
      return stopHookChain();
    },
  };

  return new Server({
    port,
    address: host,
    // We run our own SIGTERM handling so the database pool is closed after
    // pending document stores have been flushed.
    stopOnSignals: false,
    // Hocuspocus's start screen writes to stdout; all logging goes through pino.
    quiet: true,
    debounce: STORE_DEBOUNCE_MS,
    maxDebounce: STORE_MAX_DEBOUNCE_MS,
    // A safety net against a runaway client, not the file-size rule: one frame
    // can carry a whole document's initial sync.
    websocketOptions: { maxPayload: MAX_TRANSPORT_PAYLOAD },
    extensions: [
      httpMount,
      // Order matters: the guard must refuse unknown projects before the
      // database extension tries to load or create anything for them.
      createProjectGuard({ repo, logger }),
      new Database({
        fetch: ({ documentName }) => repo.loadSnapshot(documentName),
        store: ({ documentName, state }) => repo.saveSnapshot(documentName, state),
      }),
      createCollabLogging(logger),
    ],
  });
}
